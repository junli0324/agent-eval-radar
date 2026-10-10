// Explicit, repeatable upgrade for sites seeded before the Inspect changelog fix. No network or LLM.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeDb, sql } from "@aihot/backend/db";
import { stableJson } from "@aihot/backend/lib/ids";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import type { SourceRow } from "@aihot/backend/sources/types";

const spec = JSON.parse(readFileSync(new URL("../sources.json", import.meta.url), "utf8")).sources
  .find((s: { id: string }) => s.id === "rss-inspect-ai") as SourceRow;
const oldConfig = { feedUrl: "https://github.com/UKGovernmentBEIS/inspect_ai/releases.atom", summaryIsBody: true, _aihot: { initialBackfillLimit: 5 } };

export async function applyInspectSourceFix() {
  assertSupportedConfig(spec.kind, spec.config);
  return sql.begin(async (tx) => {
    const [before] = await tx`SELECT * FROM sources WHERE id = ${spec.id} FOR UPDATE`;
    if (!before) throw new Error("Inspect source missing; run the normal seed first");
    const old = before.kind === "rss" && stableJson(before.config) === stableJson(oldConfig);
    const current = before.kind === spec.kind && stableJson(before.config) === stableJson(spec.config);
    if (!old && !current) throw new Error("Inspect has custom settings; review them in admin before applying this upgrade");
    const changed = old || before.name !== spec.name;
    if (changed) {
      await tx`UPDATE sources SET name = ${spec.name}, kind = ${spec.kind}, config = ${tx.json(spec.config as never)},
        cursor = CASE WHEN ${old} THEN '{}'::jsonb ELSE cursor END,
        next_fetch_at = now(), updated_at = now() WHERE id = ${spec.id}`;
    }

    // Keep the single manual trial's article id, analysis and receipts, but replace its moving
    // date anchor with the same version-pinned identity the automatic collector now uses.
    const manual = await tx<{ id: string; version: string }[]>`
      SELECT id, raw->>'version' AS version FROM articles
      WHERE source_id = ${spec.id} AND url LIKE 'https://inspect.aisi.org.uk/CHANGELOG.html#%'
        AND raw->>'officialChangelog' = url AND raw->>'version' ~ '^v?[0-9]+[.][0-9]+[.][0-9]+$'
      FOR UPDATE`;
    for (const row of manual) {
      const url = `https://github.com/UKGovernmentBEIS/inspect_ai/blob/${row.version}/CHANGELOG.md`;
      const key = `url:${url}`;
      const [duplicate] = await tx`SELECT id FROM articles WHERE identity_key = ${key} AND id <> ${row.id}`;
      if (duplicate) throw new Error("A version-pinned duplicate already exists; no data was changed");
      await tx`UPDATE articles SET url = ${url}, identity_key = ${key}, updated_at = now() WHERE id = ${row.id}`;
    }
    if (changed || manual.length) {
      const published = await tx<{ article_id: string }[]>`SELECT article_id FROM publications WHERE source_id = ${spec.id}`;
      for (const p of published) await publishArticleTx(tx, p.article_id);
      await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after)
        VALUES ('local-upgrade', 'source.inspect-changelog-upgrade', ${`source:${spec.id}`}, 'Replace empty tag feed with official version notes',
          ${tx.json({ name: before.name, kind: before.kind, config: before.config } as never)},
          ${tx.json({ name: spec.name, kind: spec.kind, config: spec.config, migratedArticleIds: manual.map((r) => r.id) } as never)})`;
    }
    return { sourceId: spec.id, changed, migratedArticles: manual.length, modelCalls: 0 };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await applyInspectSourceFix(), null, 2));
  } finally {
    await stopBoss();
    await closeDb();
  }
}

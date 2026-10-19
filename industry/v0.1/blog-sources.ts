// Optional local sources, separate from the twelve-source v0.1 seed. No network or model calls here.
import { fileURLToPath } from "node:url";
import { sql, closeDb } from "@aihot/backend/db";
import { stableJson } from "@aihot/backend/lib/ids";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import { stopBoss } from "@aihot/backend/jobs/queue";
import type { SourceRow } from "@aihot/backend/sources/types";

export const BLOG_SOURCES: SourceRow[] = [
  // In the existing substring filter an empty drop marker matches everything; only the explicit
  // keep words admit a card. This is a cheap discovery filter, never a selection verdict.
  {
    id: "web-langchain-blog", name: "LangChain · 官方博客", kind: "web_list", tier: "T1_5",
    participation_mode: "editorial", first_party: true, interval_minutes: 180, enabled: true, cursor: null, fail_count: 0,
    config: { url: "https://www.langchain.com/blog", itemSelector: ".blog-item", linkSelector: "a.blog-link-absolute",
      titleSelector: "h2", publishedAtSelector: ".date-color", publishedAtUtcOffset: "+00:00",
      allowUrlPrefixes: ["https://www.langchain.com/blog/"], sortByPublishedAt: true, fetchPublicContent: true,
      _aihot: { initialBackfillLimit: 5 },
      ingestNoiseFilter: { dropMarkers: [""], keepIfMatches: ["eval", "benchmark", "grader", "red team", "redteam"] } },
  },
  {
    id: "web-anthropic-research", name: "Anthropic · Research", kind: "web_list", tier: "T1_5",
    participation_mode: "editorial", first_party: true, interval_minutes: 180, enabled: true, cursor: null, fail_count: 0,
    config: { url: "https://www.anthropic.com/research", itemSelector: 'a[class*="PublicationList"][href^="/research/"]',
      titleSelector: 'span[class*="__title"]', publishedAtSelector: "time", publishedAtUtcOffset: "+00:00",
      allowUrlPrefixes: ["https://www.anthropic.com/research/"], sortByPublishedAt: true, fetchPublicContent: true,
      _aihot: { initialBackfillLimit: 5 },
      ingestNoiseFilter: { dropMarkers: [""], keepIfMatches: ["eval", "benchmark", "agent", "alignment assessment"] } },
  },
];

export async function installBlogSources() {
  if (process.env.COLLECT_ENABLED !== "false" || process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Install requires COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false");
  for (const source of BLOG_SOURCES) assertSupportedConfig(source.kind, source.config);
  return sql.begin(async tx => {
    const results = [];
    for (const source of BLOG_SOURCES) {
      const created = await tx`INSERT INTO sources (id, name, kind, config, tier, participation_mode, first_party,
          interval_minutes, site_fulltext, syndicate_fulltext, enabled, imported_from, next_fetch_at)
        VALUES (${source.id}, ${source.name}, ${source.kind}, ${tx.json(source.config as never)}, ${source.tier},
          ${source.participation_mode}, true, ${source.interval_minutes}, false, false, true, 'agent-eval-blog-trial', now())
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      const [existing] = await tx`SELECT kind, config, participation_mode, site_fulltext, syndicate_fulltext, imported_from, enabled FROM sources WHERE id = ${source.id} FOR UPDATE`;
      if (!existing || existing.kind !== source.kind || stableJson(existing.config) !== stableJson(source.config) || existing.participation_mode !== 'editorial' || existing.site_fulltext || existing.syndicate_fulltext || existing.imported_from !== 'agent-eval-blog-trial') throw new Error("Existing blog source differs; entire install rolled back, review in admin");
      if (created.length) await tx`INSERT INTO audit_log (actor, action, subject, reason, after)
        VALUES ('local-blog-trial', 'source.create', ${`source:${source.id}`}, 'Optional official evaluation research/blog discovery',
          ${tx.json({ id: source.id, kind: source.kind, config: source.config, tier: source.tier } as never)})`;
      results.push({ sourceId: source.id, created: created.length > 0, enabled: existing.enabled });
    }
    return { sources: results, modelCalls: 0, note: "Sources installed only. Worker stays stopped. First collection is backfill; subsequent new items follow the existing 48-hour discovery rule." };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await installBlogSources(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Blog source install failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}

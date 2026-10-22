import { fileURLToPath } from "node:url";
import { sql, closeDb } from "@aihot/backend/db";
import { stableJson } from "@aihot/backend/lib/ids";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import { FRONTIER_IMPORT, FRONTIER_SOURCES, SIMON_SEED_CONFIG } from "./frontier-catalog.ts";
import { TRIAL_LOCK } from "./auto-trial.ts";

// Install only. Normal collection still owns discovery dates, backfill and source backoff.
export async function installFrontierSources() {
  if (process.env.COLLECT_ENABLED !== "false" || process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Install requires COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false");
  for (const source of FRONTIER_SOURCES) assertSupportedConfig(source.kind, source.config);
  return sql.begin(async tx => {
    const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${TRIAL_LOCK})) AS locked`;
    if (!lock!.locked) throw new Error("Run docker compose stop worker before installing sources");
    const results = [];
    for (const source of FRONTIER_SOURCES) {
      const created = await tx`INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode,
          interval_minutes, site_fulltext, syndicate_fulltext, enabled, imported_from, next_fetch_at)
        VALUES (${source.id}, ${source.name}, ${source.kind}, ${tx.json(source.config as never)}, ${source.tier}, ${source.first_party}, 'editorial',
          ${source.interval_minutes}, false, false, true, ${FRONTIER_IMPORT}, now())
        ON CONFLICT (id) DO NOTHING RETURNING id`;
      const [saved] = await tx`SELECT kind, config, enabled, participation_mode, site_fulltext, syndicate_fulltext, imported_from
        FROM sources WHERE id = ${source.id} FOR UPDATE`;
      const upgrade = source.id === 'rss-simon-willison' && saved?.imported_from === null && stableJson(saved.config) === stableJson(SIMON_SEED_CONFIG);
      if (!saved || saved.kind !== source.kind || saved.participation_mode !== 'editorial' || saved.site_fulltext || saved.syndicate_fulltext
        || (!upgrade && (saved.imported_from !== FRONTIER_IMPORT || stableJson(saved.config) !== stableJson(source.config)))) {
        throw new Error(`Source ${source.id} has custom settings; entire install rolled back, review in admin`);
      }
      if (upgrade) await tx`UPDATE sources SET config = ${tx.json(source.config as never)}, imported_from = ${FRONTIER_IMPORT}, updated_at = now() WHERE id = ${source.id}`;
      if (created.length || upgrade) await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after)
        VALUES ('local-frontier-sources', ${upgrade ? 'source.config.update' : 'source.create'}, ${`source:${source.id}`},
          'Add research and evaluation practice discovery; preserve trial, budget, cursors and manual pauses',
          ${upgrade ? tx.json({ config: saved.config, imported_from: saved.imported_from }) : null},
          ${tx.json({ config: source.config, imported_from: FRONTIER_IMPORT } as never)})`;
      results.push({ sourceId: source.id, created: !!created.length, configUpdated: upgrade, enabled: saved.enabled });
    }
    return { sources: results, modelCalls: 0, note: "Installed only. Resume with both Compose files. Trial expiry and budgets unchanged; first imports remain backfill." };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error("Run frontier-sources.ts without arguments");
    console.log(JSON.stringify(await installFrontierSources(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Source install failed"); process.exitCode = 1; }
  finally { await closeDb(); }
}

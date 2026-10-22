import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { stableJson } from "@aihot/backend/lib/ids";
import { FRONTIER_SOURCES, SIMON_SEED_CONFIG } from "../industry/v0.1/frontier-catalog.ts";
import { installFrontierSources } from "../industry/v0.1/frontier-sources.ts";
import { TRIAL_KEY, TRIAL_LOCK } from "../industry/v0.1/auto-trial.ts";

after(async () => { await stopBoss(); await closeDb(); });

test("source expansion is atomic, requires worker exit and preserves budget, expiry, backoff and manual edits", async () => {
  process.env.COLLECT_ENABLED = "false"; process.env.MODEL_CALLS_ENABLED = "false";
  const ids = FRONTIER_SOURCES.map(s => s.id);
  const beforeBudget = await sql`SELECT * FROM budgets ORDER BY service`;
  const [beforeCalls] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
  const [beforeTrial] = await sql`SELECT value FROM settings WHERE key = ${TRIAL_KEY}`;
  const trial = { version: 1, state: "active", startedAt: "2026-10-21T14:15:31Z", expiresAt: "2026-10-24T14:15:31Z" };
  try {
    await sql`INSERT INTO settings (key, value) VALUES (${TRIAL_KEY}, ${sql.json(trial)}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
    await sql`INSERT INTO sources (id, name, kind, config, tier, enabled, cursor, fail_count, health, next_fetch_at)
      VALUES ('rss-simon-willison', 'Manual name', 'rss', ${sql.json(SIMON_SEED_CONFIG)}, 'T2', false,
        '{"initializedAt":"2026-10-01","custom":"keep"}', 2, 'degraded', '2099-01-01')`;
    const held = await sql.reserve();
    try {
      await held`SELECT pg_advisory_lock(hashtext(${TRIAL_LOCK}))`;
      await assert.rejects(installFrontierSources(), /stop worker/);
      assert.equal((await sql`SELECT id FROM sources WHERE id = 'rss-arxiv-agent-papers'`).length, 0);
    } finally { await held`SELECT pg_advisory_unlock(hashtext(${TRIAL_LOCK}))`; held.release(); }
    const first = await installFrontierSources();
    assert.equal(first.sources.filter(s => s.created).length, 4);
    assert.equal(first.sources.find(s => s.sourceId === 'rss-simon-willison')!.configUpdated, true);
    const [saved] = await sql`SELECT * FROM sources WHERE id = 'rss-simon-willison'`;
    assert.equal(saved!.enabled, false); assert.equal(saved!.name, 'Manual name');
    assert.equal(saved!.cursor.custom, 'keep'); assert.equal(saved!.cursor.initializedAt, '2026-10-01');
    assert.equal(saved!.fail_count, 2); assert.equal(saved!.health, 'degraded');
    assert.equal(saved!.next_fetch_at.toISOString(), '2099-01-01T00:00:00.000Z');
    assert.equal(saved!.site_fulltext || saved!.syndicate_fulltext, false);
    assert.equal(saved!.config.feedUrl, 'https://simonwillison.net/tags/evals.atom');
    assert.equal((await installFrontierSources()).sources.some(s => s.created || s.configUpdated), false);
    assert.deepEqual(await sql`SELECT * FROM budgets ORDER BY service`, beforeBudget);
    assert.equal(stableJson((await sql`SELECT value FROM settings WHERE key = ${TRIAL_KEY}`)[0]!.value), stableJson(trial));
    await sql`DELETE FROM sources WHERE id = 'rss-arxiv-agent-papers'`;
    await sql`UPDATE sources SET config = '{}' WHERE id = 'rss-metr-research'`;
    await assert.rejects(installFrontierSources(), /rolled back/);
    assert.equal((await sql`SELECT id FROM sources WHERE id = 'rss-arxiv-agent-papers'`).length, 0, 'earlier source insert rolls back on a later custom config');
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, beforeCalls!.n);
    process.env.MODEL_CALLS_ENABLED = "true";
    await assert.rejects(installFrontierSources(), /MODEL_CALLS_ENABLED=false/);
  } finally {
    process.env.MODEL_CALLS_ENABLED = "false";
    await sql`DELETE FROM sources WHERE id IN ${sql(ids)}`;
    await sql`DELETE FROM audit_log WHERE actor = 'local-frontier-sources'`;
    if (beforeTrial) await sql`UPDATE settings SET value = ${sql.json(beforeTrial.value)} WHERE key = ${TRIAL_KEY}`;
    else await sql`DELETE FROM settings WHERE key = ${TRIAL_KEY}`;
  }
});

import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { BLOG_SOURCES, LEGACY_RESEARCH_CONFIG, installBlogSources } from "../industry/v0.1/blog-sources.ts";
import { stableJson } from "@aihot/backend/lib/ids";

after(async () => { await stopBoss(); await closeDb(); });

test("blog install is atomic, idempotent and preserves manual pauses and cursors without calls", async () => {
  process.env.COLLECT_ENABLED = "false";
  process.env.MODEL_CALLS_ENABLED = "false";
  const ids = BLOG_SOURCES.map(s => s.id);
  const [before] = await sql`SELECT count(*) AS n FROM receipts`;
  try {
    const first = await installBlogSources();
    assert.equal(first.sources.every(s => s.created), true);
    await sql`UPDATE sources SET enabled = false, cursor = '{"initializedAt":"2026-10-01"}', tier = 'T2' WHERE id = ${ids[0]!}`;
    const again = await installBlogSources();
    assert.equal(again.sources.every(s => !s.created), true);
    const [saved] = await sql`SELECT enabled, cursor, tier, site_fulltext, syndicate_fulltext FROM sources WHERE id = ${ids[0]!}`;
    assert.equal(saved!.enabled, false);
    assert.equal(saved!.cursor.initializedAt, "2026-10-01");
    assert.equal(saved!.tier, "T2");
    assert.equal(saved!.site_fulltext || saved!.syndicate_fulltext, false);
    await sql`UPDATE sources SET config = ${sql.json(LEGACY_RESEARCH_CONFIG)}, enabled = false, tier = 'T2',
      cursor = '{"initializedAt":"2026-10-01"}', fail_count = 1, health = 'degraded',
      next_fetch_at = '2099-01-01' WHERE id = ${ids[1]!}`;
    const migrated = await installBlogSources();
    assert.equal(migrated.sources.find(s => s.sourceId === ids[1])!.configUpdated, true);
    const [updated] = await sql`SELECT config, enabled, cursor, tier, fail_count, health, next_fetch_at FROM sources WHERE id = ${ids[1]!}`;
    assert.equal(stableJson(updated!.config), stableJson(BLOG_SOURCES[1]!.config));
    assert.equal(updated!.enabled, false); assert.equal(updated!.tier, 'T2');
    assert.equal(updated!.cursor.initializedAt, "2026-10-01");
    assert.equal(updated!.fail_count, 1); assert.equal(updated!.health, 'degraded');
    assert.equal(updated!.next_fetch_at.toISOString(), '2099-01-01T00:00:00.000Z');
    assert.equal((await installBlogSources()).sources.some(s => s.configUpdated), false);
    await sql`DELETE FROM sources WHERE id = ${ids[0]!}`;
    await sql`UPDATE sources SET config = '{}' WHERE id = ${ids[1]!}`;
    await assert.rejects(installBlogSources(), /rolled back/);
    assert.equal((await sql`SELECT id FROM sources WHERE id = ${ids[0]!}`).length, 0, "first insert rolls back when the second source conflicts");
    const [afterCalls] = await sql`SELECT count(*) AS n FROM receipts`;
    assert.equal(afterCalls!.n, before!.n);
    process.env.MODEL_CALLS_ENABLED = "true";
    await assert.rejects(installBlogSources(), /MODEL_CALLS_ENABLED=false/);
  } finally {
    await sql`DELETE FROM sources WHERE id IN ${sql(ids)}`;
    process.env.MODEL_CALLS_ENABLED = "false";
  }
});

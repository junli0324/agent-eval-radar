import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { applyInspectSourceFix } from "../industry/v0.1/apply-inspect-source-fix.ts";

const id = "rss-inspect-ai";
const oldConfig = { feedUrl: "https://github.com/UKGovernmentBEIS/inspect_ai/releases.atom", summaryIsBody: true, _aihot: { initialBackfillLimit: 5 } };
after(async () => {
  await sql`DELETE FROM article_discoveries WHERE source_id = ${id}`;
  await sql`DELETE FROM article_revisions WHERE article_id IN (SELECT id FROM articles WHERE source_id = ${id})`;
  await sql`DELETE FROM articles WHERE source_id = ${id}`;
  await sql`DELETE FROM audit_log WHERE subject = ${`source:${id}`} AND actor = 'local-upgrade'`;
  await sql`DELETE FROM sources WHERE id = ${id}`;
  await closeDb();
});

test("Inspect upgrade preserves trial identity and operator controls, resets the first-import cap and is repeatable", async () => {
  await sql`INSERT INTO sources (id, name, kind, config, tier, enabled, cursor)
    VALUES (${id}, 'Inspect AI · Releases', 'rss', ${sql.json(oldConfig)}, 'T2', false,
      '{"initializedAt":"2026-10-01T00:00:00Z"}'::jsonb)`;
  const url = "https://inspect.aisi.org.uk/CHANGELOG.html#october-2026";
  const m = await upsertMaterial({ sourceId: id, url, identityKey: `url:${url}`, title: "Inspect AI 0.3.277 changelog",
    bodyText: "Fixed scoring.", bodyStatus: "ok", via: "import", backfill: "local-trial",
    raw: { officialChangelog: url, version: "0.3.277" } });
  const result = await applyInspectSourceFix();
  assert.equal(result.changed, true);
  assert.equal(result.migratedArticles, 1);
  const [source] = await sql`SELECT * FROM sources WHERE id = ${id}`;
  assert.equal(source!.kind, "web_list");
  assert.equal(source!.config.adapter, "inspect_changelog");
  assert.equal(source!.config._aihot.initialBackfillLimit, 5);
  assert.deepEqual(source!.cursor, {});
  assert.equal(source!.enabled, false);
  assert.equal(source!.tier, "T2");
  const [article] = await sql`SELECT * FROM articles WHERE id = ${m.articleId}`;
  assert.equal(article!.url, "https://github.com/UKGovernmentBEIS/inspect_ai/blob/0.3.277/CHANGELOG.md");
  assert.equal(article!.identity_key, `url:${article!.url}`);
  assert.equal(article!.body_text, "Fixed scoring.");
  assert.equal(article!.revision, 1);
  const again = await upsertMaterial({ sourceId: id, url: article!.url, title: article!.title,
    bodyText: article!.body_text, bodyStatus: "ok", via: "fetch" });
  assert.equal(again.articleId, m.articleId);
  assert.equal(again.created, false);
  assert.deepEqual(await applyInspectSourceFix(), { sourceId: id, changed: false, migratedArticles: 0, modelCalls: 0 });
});

test("Inspect upgrade refuses custom source configs without overwriting them", async () => {
  await sql`UPDATE sources SET config = config || '{"detail":{"maxFetches":1}}'::jsonb WHERE id = ${id}`;
  const [before] = await sql`SELECT config, updated_at FROM sources WHERE id = ${id}`;
  await assert.rejects(applyInspectSourceFix(), /custom settings/);
  const [after] = await sql`SELECT config, updated_at FROM sources WHERE id = ${id}`;
  assert.deepEqual(after, before);
});

test("a conflicting trial identity rolls back the source upgrade instead of dropping either article", async () => {
  await sql`UPDATE sources SET kind = 'rss', name = 'Inspect AI · Releases', config = ${sql.json(oldConfig)},
    cursor = '{"initializedAt":"2026-10-01T00:00:00Z"}'::jsonb WHERE id = ${id}`;
  const url = "https://inspect.aisi.org.uk/CHANGELOG.html#october-2026-1";
  const manual = await upsertMaterial({ sourceId: id, url, identityKey: `url:${url}`, title: "Trial",
    via: "import", raw: { officialChangelog: url, version: "0.3.276" } });
  const duplicate = await upsertMaterial({ sourceId: id,
    url: "https://github.com/UKGovernmentBEIS/inspect_ai/blob/0.3.276/CHANGELOG.md", title: "Collected", via: "fetch" });
  const [before] = await sql`SELECT name, kind, config, cursor, updated_at FROM sources WHERE id = ${id}`;
  await assert.rejects(applyInspectSourceFix(), /duplicate already exists/);
  const [after] = await sql`SELECT name, kind, config, cursor, updated_at FROM sources WHERE id = ${id}`;
  assert.deepEqual(after, before);
  assert.equal((await sql`SELECT id FROM articles WHERE id IN ${sql([manual.articleId, duplicate.articleId])}`).length, 2);
});

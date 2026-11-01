import { tag } from './setup.ts';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { correctQuality, correctionSnapshot } from '../industry/v0.1/quality-corrections.ts';

after(async () => { await stopBoss(); await closeDb(); });

test('reviewed corrections are atomic, preserve evidence and manual fields, demote through the ledger, and retry without new writes', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const source = `quality-${tag()}`, ids: string[] = [];
  await sql`INSERT INTO sources (id,name,kind,tier,site_fulltext) VALUES (${source},'Quality fixture','external','T1_5',false)`;
  const [receipts] = await sql`SELECT count(*) AS n FROM receipt_attempts`;
  try {
    for (let i = 0; i < 2; i++) {
      const material = await upsertMaterial({ sourceId: source, url: `https://example.org/${source}/${i}`, title: 'Agent evaluation fixture',
        bodyText: 'Original task-level evidence', bodyStatus: 'ok', via: 'import', backfill: 'test' });
      ids.push(material.articleId);
      await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,score,selected)
        VALUES (${material.articleId},1,'rule','pass','methods',${['评测方法']},'Agent 评测','待补充的原摘要',${i ? 44 : 88},${!i})`;
      await publishArticle(material.articleId, { releasedAt: new Date(Date.now() - 3600000) });
    }
    await sql`INSERT INTO editorial_overrides (article_id,fields,reason,updated_by)
      VALUES (${ids[1]!},' {"silent":true}'::jsonb,'Keep manual notification preference','human')`;
    const { snapshots } = await correctionSnapshot(ids);
    const plan = { version: 1, corrections: snapshots.map((s, i) => ({ articleId: s.articleId, url: s.url,
      expectedFingerprint: s.expectedFingerprint, fields: i ? { summary: '补齐结果，并保留作者自报与实验设置。' } : { selected: false }, reason: i ? '核对原始证据后补摘要' : '待复核评测对象，先移出精选' })) };
    const auditCount = async () => (await sql`SELECT count(*) AS n FROM audit_log WHERE subject IN ${sql(ids.map(id => `content:${id}`))}`)[0]!.n;
    const ledgerCount = async () => (await sql`SELECT count(*) AS n FROM selected_ledger WHERE article_id IN ${sql(ids)}`)[0]!.n;
    const audits = await auditCount(), ledger = await ledgerCount();
    assert.equal((await correctQuality(plan)).changed, 0);
    assert.equal(await auditCount(), audits); assert.equal(await ledgerCount(), ledger);
    await assert.rejects(correctQuality({ ...plan, corrections: plan.corrections.map((c,i) => i ? { ...c, expectedFingerprint: '0'.repeat(64) } : c) }, true), /state changed/);
    assert.equal((await sql`SELECT selected FROM publications WHERE article_id=${ids[0]!}`)[0]!.selected, true);
    assert.equal((await sql`SELECT count(*) AS n FROM editorial_overrides WHERE article_id=${ids[0]!}`)[0]!.n, 0);
    await sql`UPDATE articles SET body_text='Changed evidence without revision bump' WHERE id=${ids[0]!}`;
    await assert.rejects(correctQuality(plan, true), /state changed/);
    await sql`UPDATE articles SET body_text='Original task-level evidence' WHERE id=${ids[0]!}`;
    await sql`UPDATE sources SET tier='T2' WHERE id=${source}`;
    await assert.rejects(correctQuality(plan, true), /state changed/);
    await sql`UPDATE sources SET tier='T1_5' WHERE id=${source}`;
    await sql`UPDATE editorial_overrides SET fields='{"silent":true,"summary":"人工新摘要"}'::jsonb WHERE article_id=${ids[1]!}`;
    const fresh = await correctionSnapshot(ids);
    await assert.rejects(correctQuality({ ...plan, corrections: plan.corrections.map((c,i) => ({ ...c, expectedFingerprint: fresh.snapshots[i]!.expectedFingerprint })) }, true), /manual edit conflicts/);
    await sql`UPDATE editorial_overrides SET fields='{"silent":true}'::jsonb WHERE article_id=${ids[1]!}`;
    assert.equal((await correctQuality(plan, true)).changed, 2);
    const rows = await sql`SELECT article_id,selected,score,summary FROM publications WHERE article_id IN ${sql(ids)} ORDER BY article_id`;
    assert.equal(rows.find(r => r.article_id === ids[0])!.selected, false);
    assert.equal(rows.find(r => r.article_id === ids[0])!.score, 88);
    assert.equal(rows.find(r => r.article_id === ids[1])!.selected, false);
    assert.equal(rows.find(r => r.article_id === ids[1])!.summary, '补齐结果，并保留作者自报与实验设置。');
    assert.equal((await sql`SELECT fields->>'silent' AS silent FROM editorial_overrides WHERE article_id=${ids[1]!}`)[0]!.silent, 'true');
    assert.equal((await sql`SELECT op FROM selected_ledger WHERE article_id=${ids[0]!} ORDER BY seq DESC LIMIT 1`)[0]!.op, 'remove');
    const appliedAudits = await auditCount(), appliedLedger = await ledgerCount();
    assert.equal(appliedAudits - audits, 2); assert.equal(appliedLedger - ledger, 1);
    assert.equal((await correctQuality(plan, true)).changed, 0);
    assert.equal(await auditCount(), appliedAudits); assert.equal(await ledgerCount(), appliedLedger);
    await sql`UPDATE editorial_overrides SET fields=fields || '{"silent":false}'::jsonb,version=version+1 WHERE article_id=${ids[1]!}`;
    await assert.rejects(correctQuality(plan, true), /state changed/);
    assert.equal(await auditCount(), appliedAudits);
    assert.equal((await sql`SELECT count(*) AS n FROM receipt_attempts`)[0]!.n, receipts!.n);
    assert.equal((await sql`SELECT count(*) AS n FROM analyses WHERE article_id IN ${sql(ids)}`)[0]!.n, 2);
  } finally {
    if (ids.length) {
      await sql`DELETE FROM audit_log WHERE subject IN ${sql(ids.map(id => `content:${id}`))}`;
      await sql`DELETE FROM selected_ledger WHERE article_id IN ${sql(ids)}`;
      await sql`DELETE FROM articles WHERE id IN ${sql(ids)}`;
    }
    await sql`DELETE FROM sources WHERE id=${source}`;
  }
});

test('correction plans reject promotions, score changes, unbounded batches and live model valves', async () => {
  process.env.COLLECT_ENABLED = 'false'; process.env.MODEL_CALLS_ENABLED = 'false';
  const spec = { articleId: 'fixture', url: 'https://example.org', expectedFingerprint: '0'.repeat(64), fields: { selected: true }, reason: 'Review' };
  await assert.rejects(correctQuality({ version: 1, corrections: [spec] }));
  await assert.rejects(correctQuality({ version: 1, corrections: [{ ...spec, fields: { score: 100 } }] }));
  await assert.rejects(correctQuality({ version: 1, corrections: Array(11).fill({ ...spec, fields: { selected: false } }) }));
  await assert.rejects(correctQuality({ version: 1, corrections: Array(2).fill({ ...spec, fields: { selected: false } }) }));
  process.env.MODEL_CALLS_ENABLED = 'true';
  try { await assert.rejects(correctionSnapshot(['fixture']), /both valves=false/); }
  finally { process.env.MODEL_CALLS_ENABLED = 'false'; }
});

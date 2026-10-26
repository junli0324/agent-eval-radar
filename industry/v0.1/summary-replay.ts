// Explicit preview only. Reuse current analysis receipts without re-judging or changing publications.
import { fileURLToPath } from 'node:url';
import { sql, closeDb } from '@aihot/backend/db';
import { finalizeCopy, translateInputOf } from '@aihot/backend/editorial/writing';
import { loadAnalyzeInput } from '@aihot/backend/editorial/input';

export async function previewSummaryReplay(ids: string[]) {
  if (process.env.COLLECT_ENABLED !== 'false' || process.env.MODEL_CALLS_ENABLED !== 'false') throw new Error('Preview requires both valves=false');
  if (!ids.length || ids.length > 20 || ids.some(id => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error('Use 1–20 explicit article ids');
  const previews = [];
  for (const id of [...new Set(ids)]) {
    const [row] = await sql`SELECT n.id, n.input_revision, n.title_zh, n.summary_zh, n.receipt_ids,
        o.fields, o.visibility, a.revision
      FROM articles a JOIN LATERAL (SELECT * FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) n ON true
      LEFT JOIN editorial_overrides o ON o.article_id = a.id WHERE a.id = ${id}`;
    if (!row || row.input_revision !== row.revision) { previews.push({ id, status: 'missing-or-stale' }); continue; }
    if (row.fields?.summary !== undefined || row.fields?.title !== undefined || row.visibility) { previews.push({ id, status: 'manual-edit-preserved' }); continue; }
    const receipts = await sql`SELECT response FROM receipts WHERE id = ANY(${row.receipt_ids}::bigint[])
      AND purpose = 'understand_article' AND status IN ('received', 'completed') AND subject = ${`article:${id}@${row.revision}`}
      ORDER BY id DESC LIMIT 1`;
    let copy;
    try { copy = JSON.parse(receipts[0]?.response?.choices?.[0]?.message?.content ?? 'null'); } catch { copy = null; }
    if (typeof copy?.titleZh !== 'string' || typeof copy?.summaryZh !== 'string') { previews.push({ id, status: 'no-supported-receipt' }); continue; }
    const input = await loadAnalyzeInput(id);
    if (!input || input.revision !== row.revision) { previews.push({ id, status: 'missing-or-stale' }); continue; }
    const next = finalizeCopy(translateInputOf(input), copy);
    previews.push({ id, analysisId: row.id, revision: row.revision, status: next.identityGuard.outcome === 'pass' ? 'preview' : 'identity-review-required',
      title: row.title_zh, before: row.summary_zh, after: next.summaryZh, changed: row.summary_zh !== next.summaryZh });
  }
  return { previews, modelCalls: 0, writes: 0, note: 'Preview only; no score, selection, tag, publication or manual override is changed.' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const option = process.argv[2];
    if (process.argv.length !== 3 || !option?.startsWith('--ids=')) throw new Error('Use summary-replay.ts --ids=id1,id2');
    console.log(JSON.stringify(await previewSummaryReplay(option.slice(6).split(',')), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Summary preview failed'); process.exitCode = 1; }
  finally { await closeDb(); }
}

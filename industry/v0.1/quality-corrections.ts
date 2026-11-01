// Explicit, evidence-reviewed copy fixes and selection demotions. Never re-score or call models.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { sql, closeDb, type Tx } from '@aihot/backend/db';
import { sha256, stableJson } from '@aihot/backend/lib/ids';
import { publishArticleTx } from '@aihot/backend/publication/publish';
import { stopBoss } from '@aihot/backend/jobs/queue';
import { TOPIC_TAGS } from '@aihot/industry/taxonomy';

const ACTOR = 'local-quality-review';
const ACTION = 'content.quality-correction';
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const Fields = z.object({ title: z.string().trim().min(1).max(300), summary: z.string().trim().min(1).max(2000), selected: z.literal(false) })
  .partial().strict();
const Plan = z.object({ version: z.literal(1), corrections: z.array(z.object({
  articleId: Id, url: z.url().refine(v => /^https?:\/\//.test(v)), expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  removeTags: z.array(z.enum(TOPIC_TAGS)).min(1).max(10).refine(v => new Set(v).size === v.length, 'Duplicate tag removals').optional(),
  fields: Fields, reason: z.string().trim().min(1).max(1000),
}).strict().refine(v => Object.keys(v.fields).length > 0 || !!v.removeTags?.length, 'Specify a copy fix, demotion or tag removal')).min(1).max(10) })
  .strict().refine(v => new Set(v.corrections.map(c => c.articleId)).size === v.corrections.length, 'Duplicate article IDs');

type Publication = { title: string; summary: string; selected: boolean; score: number | null; category: string; tags: string[];
  visibility: string; eligible: boolean; published_at: string | null; timeline_at: string; backfill: boolean; url: string };
type Override = { fields: Record<string, unknown>; version: number; visibility: string | null; updated_by: string };

function offline() {
  if (process.env.COLLECT_ENABLED !== 'false' || process.env.MODEL_CALLS_ENABLED !== 'false') throw new Error('Corrections require both valves=false');
}

async function state(tx: Tx, id: string) {
  const [row] = await tx<{ material: { revision: number; url: string; title: string; body: string | null; excerpt: string | null };
    analysis: { id: number; input_revision: number }; publication: Publication; override: Override | null; source: unknown }[]>`
    SELECT jsonb_build_object('revision',a.revision,'url',a.url,'title',a.title,'body',a.body_text,'excerpt',a.excerpt) AS material,
      to_jsonb(n) AS analysis, to_jsonb(p) AS publication, to_jsonb(o) AS override,
      jsonb_build_object('tier',s.tier,'name',s.name,'mode',s.participation_mode,'siteFulltext',s.site_fulltext,'syndicateFulltext',s.syndicate_fulltext) AS source
    FROM articles a JOIN sources s ON s.id=a.source_id
    JOIN LATERAL (SELECT * FROM analyses WHERE article_id=a.id ORDER BY input_revision DESC,id DESC LIMIT 1) n ON true
    JOIN publications p ON p.article_id=a.id LEFT JOIN editorial_overrides o ON o.article_id=a.id WHERE a.id=${id}`;
  if (!row || row.material.revision !== row.analysis.input_revision) throw new Error(`Missing or stale publication: ${id}`);
  const fingerprint = sha256(stableJson({ ...row, material: { ...row.material,
    body: sha256(row.material.body ?? ''), excerpt: sha256(row.material.excerpt ?? '') } }));
  return { ...row, fingerprint };
}

export async function correctionSnapshot(ids: string[]) {
  offline();
  z.array(Id).min(1).max(10).parse(ids);
  return sql.begin('isolation level repeatable read read only', async tx => {
    const snapshots = [];
    for (const id of [...new Set(ids)]) {
      const s = await state(tx, id);
      snapshots.push({ articleId: id, url: s.material.url, expectedFingerprint: s.fingerprint, analysisId: s.analysis.id,
        overrideVersion: s.override?.version ?? 0, title: s.publication.title, summary: s.publication.summary,
        selected: s.publication.selected, score: s.publication.score, tags: s.publication.tags });
    }
    return { snapshots, modelCalls: 0, writes: 0 };
  });
}

export async function correctQuality(input: unknown, apply = false) {
  offline();
  const plan = Plan.parse(input);
  return sql.begin(apply ? '' : 'isolation level repeatable read read only', async tx => {
    if (apply) {
      await tx`SELECT pg_advisory_xact_lock(hashtext('local-quality-review'))`;
      await tx`SELECT id FROM articles WHERE id IN ${tx(plan.corrections.map(c => c.articleId))} ORDER BY id FOR UPDATE`;
    }
    // Validate the whole batch before writing anything. A stale article aborts every correction.
    const prepared = [];
    for (const spec of plan.corrections) {
      const before = await state(tx, spec.articleId), specHash = sha256(stableJson(spec));
      if (before.material.url !== spec.url) throw new Error(`URL differs from reviewed material: ${spec.articleId}`);
      if (before.fingerprint !== spec.expectedFingerprint) {
        const [previous] = await tx`SELECT after->>'fingerprint' AS fingerprint FROM audit_log
          WHERE actor=${ACTOR} AND action=${ACTION} AND subject=${`content:${spec.articleId}`} AND after->>'specHash'=${specHash}
          ORDER BY id DESC LIMIT 1`;
        if (previous?.fingerprint === before.fingerprint) { prepared.push({ spec, before, specHash, patch: {} as Record<string, unknown>, alreadyApplied: true }); continue; }
        throw new Error(`Reviewed state changed; take a new snapshot: ${spec.articleId}`);
      }
      if (!before.publication.eligible || before.publication.visibility !== 'public') throw new Error(`Only existing public material may be corrected: ${spec.articleId}`);
      const patch: Record<string, unknown> = { ...spec.fields };
      if (spec.removeTags) {
        if (spec.removeTags.some(t => !before.publication.tags.includes(t))) throw new Error(`Requested tag is absent: ${spec.articleId}`);
        patch.tags = before.publication.tags.filter(t => !spec.removeTags!.includes(t as typeof TOPIC_TAGS[number]));
      }
      for (const [key, value] of Object.entries(patch)) {
        if (before.override && key in before.override.fields && stableJson(before.override.fields[key]) !== stableJson(value)) {
          throw new Error(`Existing manual edit conflicts; nothing committed: ${spec.articleId}.${key}`);
        }
      }
      prepared.push({ spec, before, specHash, patch, alreadyApplied: false });
    }
    const results = [];
    for (const { spec, before, specHash, patch, alreadyApplied } of prepared) {
      if (!apply || alreadyApplied) {
        results.push({ articleId: spec.articleId, status: alreadyApplied ? 'already-applied' : 'preview',
          before: before.publication, fields: alreadyApplied ? spec.fields : patch, removeTags: spec.removeTags, reason: spec.reason });
        continue;
      }
      const fields = { ...(before.override?.fields ?? {}), ...patch };
      const written = await tx`INSERT INTO editorial_overrides (article_id,fields,reason,updated_by)
        VALUES (${spec.articleId},${tx.json(fields as never)},${spec.reason},${ACTOR})
        ON CONFLICT (article_id) DO UPDATE SET fields=EXCLUDED.fields,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,
          version=editorial_overrides.version+1,updated_at=now() WHERE editorial_overrides.version=${before.override?.version ?? 0} RETURNING version`;
      if (!written.count) throw new Error('Concurrent manual edit; nothing committed');
      const projected = await publishArticleTx(tx, spec.articleId);
      const after = await state(tx, spec.articleId), p = after.publication, old = before.publication;
      if (!projected || p.score !== old.score || p.selected !== (spec.fields.selected ?? old.selected) ||
        p.title !== (spec.fields.title ?? old.title) || p.summary !== (spec.fields.summary ?? old.summary) ||
        stableJson([p.category,p.tags,p.visibility,p.eligible,p.published_at,p.timeline_at,p.backfill,p.url]) !==
        stableJson([old.category,patch.tags ?? old.tags,old.visibility,old.eligible,old.published_at,old.timeline_at,old.backfill,old.url])) {
        throw new Error('Publication invariant failed; nothing committed');
      }
      await tx`INSERT INTO audit_log (actor,action,subject,reason,before,after)
        VALUES (${ACTOR},${ACTION},${`content:${spec.articleId}`},${spec.reason},
          ${tx.json({ override: before.override, publication: old, fingerprint: before.fingerprint } as never)},
          ${tx.json({ fields, publication: p, fingerprint: after.fingerprint, specHash } as never)})`;
      results.push({ articleId: spec.articleId, status: 'applied', selected: p.selected, ledger: projected.ledger });
    }
    return { status: apply ? 'applied' : 'preview', changed: apply ? results.filter(r => r.status === 'applied').length : 0,
      results, modelCalls: 0 };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, option, ...extra] = process.argv.slice(2);
    if (extra.length || (command === 'snapshot' ? !option?.startsWith('--ids=') :
      !['preview','apply'].includes(command ?? '') || !option?.startsWith('--plan='))) throw new Error('Use snapshot --ids=id1,id2 or preview/apply --plan=PATH');
    let plan: unknown;
    if (command !== 'snapshot') { try { plan = JSON.parse(await readFile(option!.slice(7), 'utf8')); } catch { throw new Error('Cannot read JSON correction plan'); } }
    console.log(JSON.stringify(command === 'snapshot' ? await correctionSnapshot(option!.slice(6).split(',')) : await correctQuality(plan, command === 'apply'), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : 'Quality correction failed'); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}

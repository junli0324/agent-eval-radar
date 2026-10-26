// Bounded local automation: reuse production operations without consuming the general job queues.
import { fileURLToPath } from "node:url";
import { sql, closeDb, type Db } from "@aihot/backend/db";
import { credential } from "@aihot/backend/config";
import { CAPABILITIES, modelFor } from "@aihot/backend/editorial/models";
import { collectSource } from "@aihot/backend/sources/collect";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";
import { groupArticle } from "@aihot/backend/events/group";
import { composeStoryDigest } from "@aihot/backend/events/digest";
import { computeHotRanking } from "@aihot/backend/events/hot";
import { catchUpReports } from "@aihot/backend/reports/compose";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";
import { stableJson } from "@aihot/backend/lib/ids";
import { shutdownSignal } from "@aihot/backend/jobs/queue";
import { RECENT_SOURCES, RECENT_DAYS, damagedCopy } from "./recent-policy.ts";

export const TRIAL_KEY = "agent-eval.auto-trial";
export const TRIAL_LOCK = "agent-eval-auto-trial";
export const TRIAL_HOURS = 72;
export const TRIAL_DAY_CALLS = 100;
export const TRIAL_ARTICLES_PER_TICK = 3;
interface Budget { per_minute: number; per_hour: number; per_day: number }
interface Trial {
  version: 1; state: "active" | "stopped"; startedAt: string; expiresAt: string;
  budgetBefore: Budget; budgetApplied: Budget;
}

export function trialActive(t: Trial | undefined, now = new Date()) {
  return t?.version === 1 && t.state === "active" && Date.parse(t.startedAt) <= +now && Date.parse(t.expiresAt) > +now;
}

const canWork = (t: Trial | undefined) => !shutdownSignal.signal.aborted && trialActive(t);

async function loadTrial(db: Db = sql): Promise<Trial | undefined> {
  const [row] = await db<{ value: Trial }[]>`SELECT value FROM settings WHERE key = ${TRIAL_KEY}`;
  return row?.value;
}

export async function verifyTrialModel() {
  if (process.env.LLM_MODEL !== "deepseek-flash" || !credential("models", "LLM_API_KEY")) throw new Error("Trial requires the configured default deepseek-flash model and its key");
  let extra;
  try { extra = JSON.parse(process.env.LLM_EXTRA_JSON ?? "{}"); } catch { throw new Error("LLM_EXTRA_JSON must be valid JSON"); }
  if (extra.thinking?.type !== "disabled") throw new Error("Trial requires LLM_EXTRA_JSON with thinking.type=disabled");
  for (const capability of Object.keys(CAPABILITIES).filter(k => !["translate", "monitor"].includes(k)) as Array<keyof typeof CAPABILITIES>) {
    if (await modelFor(capability) !== "default") throw new Error(`Trial requires the default model for ${capability}; review the admin model setting`);
  }
}

async function currentBudget(db: Db = sql) {
  const [b] = await db<Budget[]>`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'llm'`;
  return b;
}

async function assertBudget(t: Trial) {
  if (stableJson(await currentBudget()) !== stableJson(t.budgetApplied)) throw new Error("Trial budget changed; worker stopped before further work");
}

function offlineValves() {
  if (process.env.COLLECT_ENABLED !== "false" || process.env.MODEL_CALLS_ENABLED !== "false") throw new Error("Prepare/stop requires both valves=false; stop the worker first");
}

export async function prepareTrial(now = new Date()) {
  offlineValves();
  await verifyTrialModel();
  return sql.begin(async tx => {
    const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${TRIAL_LOCK})) AS locked`;
    if (!lock!.locked) throw new Error("Stop the trial worker before preparing it");
    const before = await loadTrial(tx);
    if (before?.state === "active") {
      if (!trialActive(before, now)) throw new Error("Previous trial expired; run stop to restore its budget before starting another");
      const b = await currentBudget(tx);
      if (stableJson(b) !== stableJson(before.budgetApplied)) throw new Error("Trial budget differs; stop and review it");
      return { status: "already-prepared", startedAt: before.startedAt, expiresAt: before.expiresAt, modelCalls: 0 };
    }
    const budgetBefore = await currentBudget(tx);
    if (!budgetBefore || Object.values(budgetBefore).some(v => v <= 0)) throw new Error("Default model budget missing or paused; review it in admin");
    const sources = await tx`SELECT id FROM sources WHERE id IN ${tx(RECENT_SOURCES)} AND enabled
      AND participation_mode = 'editorial' AND kind IN ('rss', 'web_list') AND NOT site_fulltext AND NOT syndicate_fulltext`;
    if (!sources.length) throw new Error("No enabled summary-only trial sources");
    const budgetApplied = { per_minute: Math.min(budgetBefore.per_minute, 5), per_hour: Math.min(budgetBefore.per_hour, 30), per_day: Math.min(budgetBefore.per_day, TRIAL_DAY_CALLS) };
    const value: Trial = { version: 1, state: "active", startedAt: now.toISOString(), expiresAt: new Date(+now + TRIAL_HOURS * 3600000).toISOString(), budgetBefore, budgetApplied };
    await tx`UPDATE budgets SET per_minute = ${budgetApplied.per_minute}, per_hour = ${budgetApplied.per_hour}, per_day = ${budgetApplied.per_day}, updated_at = now() WHERE service = 'llm'`;
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${TRIAL_KEY}, ${tx.json(value as never)}, 'local-auto-trial')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after)
      VALUES ('local-auto-trial', 'trial.prepare', ${TRIAL_KEY}, '72-hour bounded automation; preserve historical work and original budget', ${tx.json(budgetBefore as never)}, ${tx.json(value as never)})`;
    return { status: "prepared", startedAt: value.startedAt, expiresAt: value.expiresAt, budget: budgetApplied,
      sources: sources.map(s => s.id), historicalQueue: "untouched-and-not-consumed", modelCalls: 0 };
  });
}

export async function stopTrial() {
  offlineValves();
  return sql.begin(async tx => {
    const [lock] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${TRIAL_LOCK})) AS locked`;
    if (!lock!.locked) throw new Error("Run docker compose stop worker before restoring the trial budget");
    const t = await loadTrial(tx);
    if (!t || t.state === "stopped") return { status: "already-stopped", modelCalls: 0 };
    const current = await currentBudget(tx);
    const restored = stableJson(current) === stableJson(t.budgetApplied);
    if (restored) await tx`UPDATE budgets SET per_minute = ${t.budgetBefore.per_minute}, per_hour = ${t.budgetBefore.per_hour}, per_day = ${t.budgetBefore.per_day}, updated_at = now() WHERE service = 'llm'`;
    const value = { ...t, state: "stopped" };
    await tx`UPDATE settings SET value = ${tx.json(value as never)}, updated_at = now() WHERE key = ${TRIAL_KEY}`;
    await tx`INSERT INTO audit_log (actor, action, subject, reason, before, after)
      VALUES ('local-auto-trial', 'trial.stop', ${TRIAL_KEY}, ${restored ? 'Restore original budget after worker exit' : 'Preserve an intervening manual budget change'}, ${tx.json(t as never)}, ${tx.json(value as never)})`;
    return { status: "stopped", budgetRestored: restored, modelCalls: 0 };
  });
}

export async function trialStatus() {
  const trial = await loadTrial();
  const [calls] = await sql`SELECT count(*)::int AS requests FROM receipt_attempts WHERE service = 'llm' AND origin = 'live' AND started_at > now() - interval '1 day'`;
  const [usage] = await sql`SELECT count(*)::int AS receipts, coalesce(sum((usage->>'total_tokens')::bigint), 0) AS tokens,
    count(*) FILTER (WHERE cost IS NULL)::int AS unknown_cost_receipts FROM receipts
    WHERE service = 'llm' AND origin = 'live' AND created_at >= ${trial?.startedAt ?? new Date().toISOString()}::timestamptz`;
  const [last] = await sql`SELECT value FROM settings WHERE key = ${TRIAL_KEY + '.last-tick'}`;
  return { trial: trial ? { state: trial.state, startedAt: trial.startedAt, expiresAt: trial.expiresAt, active: trialActive(trial) } : null,
    budget: await currentBudget(), requests24h: calls!.requests, trialUsage: usage, lastTick: last?.value ?? null,
    sources: RECENT_SOURCES, modelCalls: 0, note: "100 requests is a rolling 24-hour ceiling shared by analysis, grouping, digests and reports, not a currency limit. Existing queues are not consumed." };
}

/** Read-only diagnostics for the CLI; the minute worker heartbeat does not run these queries. */
export async function trialDiagnostics(now = new Date()) {
  const cutoff = new Date(+now - RECENT_DAYS * 86400000);
  const sources = await sql`SELECT s.id, s.name, s.enabled, s.health, s.fail_count, s.last_ok_at, s.next_fetch_at,
      (s.enabled AND s.participation_mode = 'editorial' AND s.kind IN ('rss', 'web_list') AND NOT s.site_fulltext AND NOT s.syndicate_fulltext) AS trial_eligible,
      r.status AS last_run_status, r.found_count, r.new_count, r.finished_at,
      coalesce((r.detail->>'notModified')::boolean, false) AS not_modified,
      (SELECT count(*)::int FROM articles a WHERE a.source_id = s.id AND a.backfill) AS archived_count
    FROM sources s LEFT JOIN LATERAL (SELECT * FROM fetch_runs WHERE source_id = s.id ORDER BY id DESC LIMIT 1) r ON true
    WHERE s.id IN ${sql(RECENT_SOURCES)} ORDER BY s.id`;
  const [pipeline] = await sql`SELECT count(*)::int AS recent_candidates,
      count(*) FILTER (WHERE n.input_revision = a.revision AND n.relevance = 'block')::int AS blocked,
      count(*) FILTER (WHERE n.input_revision IS DISTINCT FROM a.revision AND a.body_status = 'ok')::int AS ready_for_analysis,
      count(*) FILTER (WHERE n.input_revision IS DISTINCT FROM a.revision AND a.body_status <> 'ok')::int AS waiting_for_body,
      count(*) FILTER (WHERE a.processing_retry_at > ${now})::int AS retry_waiting,
      count(*) FILTER (WHERE p.eligible AND p.visibility = 'public' AND p.selected AND p.visible_after <= ${now})::int AS selected_released,
      count(*) FILTER (WHERE p.eligible AND p.visibility = 'public' AND NOT p.selected)::int AS ordinary_public
    FROM articles a JOIN sources s ON s.id = a.source_id
    LEFT JOIN LATERAL (SELECT input_revision, relevance FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) n ON true
    LEFT JOIN publications p ON p.article_id = a.id
    WHERE a.source_id IN ${sql(RECENT_SOURCES)} AND s.enabled AND s.participation_mode = 'editorial'
      AND s.kind IN ('rss', 'web_list') AND NOT s.site_fulltext AND NOT s.syndicate_fulltext AND NOT a.backfill
      AND a.published_at >= ${cutoff} AND a.published_at <= ${now} AND a.discovered_at >= ${cutoff}`;
  return { sourceHealth: sources, missingSources: RECENT_SOURCES.filter(id => !sources.some(s => s.id === id)), pipeline,
    diagnosticNote: "Read-only. found_count=0 with not_modified=true means HTTP 304. Counts cover recent eligible sources; retry_waiting may overlap body/analysis counts. Backfill is separate." };
}

const productionOps = { collect: collectSource, extract: (id: string) => extractArticleBody(id, false), analyze: analyzeArticle,
  publish: publishArticle, group: groupArticle, digest: composeStoryDigest, reports: catchUpReports, hot: computeHotRanking };
type Operations = typeof productionOps;

export async function runTrialTick(options: { now?: Date; maintenance?: boolean; operations?: Partial<Operations> } = {}) {
  const now = options.now ?? new Date();
  const t = await loadTrial();
  if (!trialActive(t, now) || shutdownSignal.signal.aborted) return { status: "inactive" };
  await assertBudget(t!);
  const ops = { ...productionOps, ...options.operations };
  const counts = { collected: 0, found: 0, created: 0, revised: 0, analyzed: 0, published: 0, grouped: 0, digests: 0 };
  const errors: Array<{ step: string; id: string; reason: string }> = [];
  const [previous] = await sql`SELECT value FROM settings WHERE key = ${TRIAL_KEY + '.last-tick'}`;
  let modelRetryAt: string | null = typeof previous?.value?.modelRetryAt === 'string'
    && Date.parse(previous.value.modelRetryAt) > +now ? previous.value.modelRetryAt : null;
  let reportCheck = previous?.value.reportCheck ?? null;
  const waitForBudget = (error: BudgetExceededError) => {
    modelRetryAt = new Date(+(options.now ?? new Date()) + Math.max(1, error.retryAfterSeconds) * 1000).toISOString();
  };
  const sources = await sql`SELECT id, next_fetch_at FROM sources WHERE id IN ${sql(RECENT_SOURCES)} AND enabled
    AND participation_mode = 'editorial' AND kind IN ('rss', 'web_list') AND NOT site_fulltext AND NOT syndicate_fulltext`;
  for (const s of sources) {
    if (s.next_fetch_at && s.next_fetch_at > now) continue;
    if (!canWork(t)) return { status: "ended", counts };
    try {
      const result = await ops.collect(s.id);
      counts.found += result.found; counts.created += result.created; counts.revised += result.revised;
      if (result.status === 'failed') errors.push({ step: "collect", id: s.id, reason: "Source collection failed; normal backoff applies" });
      else counts.collected++;
    }
    catch { errors.push({ step: "collect", id: s.id, reason: "Source collection failed; normal backoff applies" }); }
  }
  // Due reports get the shared budget before new article work or optional story digests.
  if (options.maintenance && canWork(t)) {
    if (modelRetryAt) reportCheck = { at: now.toISOString(), status: 'budget-waiting', generated: [] };
    else {
      await assertBudget(t!);
      try {
        const reports = await ops.reports(now);
        reportCheck = { at: now.toISOString(), status: 'checked', generated: reports.generated };
      } catch (error) {
        if (error instanceof BudgetExceededError) waitForBudget(error);
        reportCheck = { at: now.toISOString(), status: modelRetryAt ? 'budget-waiting' : 'failed', generated: [] };
        errors.push({ step: 'reports', id: 'due', reason: modelRetryAt ? 'Report generation waits for shared budget recovery' : 'Report generation waits for retry' });
      }
    }
  }
  const ids = sources.map(s => s.id);
  if (ids.length && !modelRetryAt) {
    const cutoff = new Date(+now - RECENT_DAYS * 86400000);
    const rows = await sql`SELECT a.id FROM articles a
      LEFT JOIN LATERAL (SELECT id, input_revision, relevance FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) n ON true
      LEFT JOIN publications p ON p.article_id = a.id
      WHERE a.source_id IN ${sql(ids)} AND NOT a.backfill
      AND a.published_at >= ${cutoff} AND a.published_at <= ${now} AND a.discovered_at >= ${cutoff}
      AND (a.processing_retry_at IS NULL OR a.processing_retry_at <= ${now})
      AND (n.input_revision IS DISTINCT FROM a.revision OR p.article_id IS NULL OR p.analysis_id IS DISTINCT FROM n.id
        OR (n.relevance = 'pass' AND a.grouped_at IS NULL AND p.visibility = 'public'))
      ORDER BY a.published_at DESC, a.id LIMIT ${TRIAL_ARTICLES_PER_TICK}`;
    for (const row of rows) {
      if (!canWork(t)) return { status: "ended", counts };
      await assertBudget(t!);
      try {
        const [a] = await sql`SELECT a.revision, a.body_status, a.grouped_at, n.input_revision, n.relevance, p.article_id AS public_id
          FROM articles a LEFT JOIN LATERAL (SELECT input_revision, relevance FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) n ON true
          LEFT JOIN publications p ON p.article_id = a.id WHERE a.id = ${row.id}`;
        if (!a) continue;
        if (a.input_revision !== a.revision) {
          if (a.body_status !== 'ok') {
            await ops.extract(row.id);
            const [body] = await sql`SELECT body_status FROM articles WHERE id = ${row.id}`;
            if (body?.body_status !== 'ok') throw new Error("Body unavailable");
          }
          if (!canWork(t)) return { status: "ended", counts };
          const result = await ops.analyze(row.id);
          counts.analyzed++;
          if (!result || result.stale || result.needsBody || !result.output) throw new Error("Analysis incomplete");
        }
        const [n] = await sql`SELECT input_revision, relevance, title_zh, summary_zh, tags FROM analyses WHERE article_id = ${row.id} ORDER BY input_revision DESC, id DESC LIMIT 1`;
        if (!n || n.input_revision !== a.revision || n.relevance === 'unknown') continue;
        if (n.relevance === 'pass' && (!/[\u3400-\u9fff]/.test(n.title_zh ?? '') || !/[\u3400-\u9fff]/.test(n.summary_zh ?? '') || damagedCopy([n.title_zh, n.summary_zh, n.tags]))) throw new Error("Public copy validation failed");
        if (!canWork(t)) return { status: "ended", counts };
        const published = await ops.publish(row.id);
        if (published?.changed) counts.published++;
        if (n.relevance === 'pass' && published?.visibility === 'public' && !a.grouped_at && canWork(t)) { await ops.group(row.id); counts.grouped++; }
      } catch (error) {
        if (shutdownSignal.signal.aborted) return { status: "ended", counts };
        if (error instanceof BudgetExceededError) { waitForBudget(error); errors.push({ step: "budget", id: row.id, reason: "Model request limit reached; work waits for budget recovery" }); break; }
        await sql`UPDATE articles SET processing_retry_at = ${new Date(+now + 6 * 3600000)} WHERE id = ${row.id}`;
        errors.push({ step: "article", id: row.id, reason: "Body, analysis, publication or grouping incomplete; retry after six hours" });
      }
    }
    if (canWork(t) && !modelRetryAt) {
      const stories = await sql`SELECT DISTINCT p.story_id FROM publications p JOIN articles a ON a.id = p.article_id
        JOIN stories st ON st.id = p.story_id AND st.merged_into IS NULL
        WHERE a.source_id IN ${sql(ids)} AND NOT a.backfill AND a.published_at >= ${cutoff} AND p.visibility = 'public' AND p.eligible
          AND (st.digest_updated_at IS NULL OR p.updated_at > st.digest_updated_at)
          AND (NOT p.selected OR p.visible_after <= ${now}) ORDER BY p.story_id LIMIT 3`;
      for (const s of stories) {
        if (!canWork(t)) break;
        await assertBudget(t!);
        try { if ((await ops.digest(s.story_id)).updated) counts.digests++; }
        catch (error) {
          if (error instanceof BudgetExceededError) waitForBudget(error);
          errors.push({ step: "digest", id: String(s.story_id), reason: error instanceof BudgetExceededError ? "Model request limit reached" : "Digest waits for retry" }); break;
        }
      }
    }
  }
  if (options.maintenance && canWork(t)) {
    await ops.hot(now);
  }
  const result = { status: modelRetryAt ? "budget-waiting" : "ok", at: now.toISOString(), counts, errors, modelRetryAt, reportCheck };
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${TRIAL_KEY + '.last-tick'}, ${sql.json(result as never)}, 'local-auto-trial')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...extra] = process.argv.slice(2);
    if (extra.length || !['prepare', 'status', 'stop'].includes(command ?? '')) throw new Error("Use prepare, status or stop");
    console.log(JSON.stringify(command === 'prepare' ? await prepareTrial() : command === 'stop' ? await stopTrial() : { ...await trialStatus(), ...await trialDiagnostics() }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Trial management failed"); process.exitCode = 1; }
  finally { await closeDb(); }
}

// Industry-specific, admin-only diagnosis. Reading this overview never starts the trial or a model.
import { sql } from '@aihot/backend/db';
import { previewDaily } from '@aihot/backend/reports/compose';
import { listedCondition } from '@aihot/backend/publication/items';
import { reportContentSql } from '@aihot/backend/publication/report-content';
import { trialDiagnostics } from './v0.1/auto-trial.ts';
import { dailyWindow } from './v0.1/recent-policy.ts';

export interface AutomationOverview {
  state: 'running' | 'budget-waiting' | 'expired' | 'stopped' | 'offline' | 'not-started' | 'budget-changed' | 'unexpected-worker';
  startedAt: string;
  expiresAt: string;
  retryAt: string | null;
  lastTickAt: string | null;
  lastCollectedAt: string | null;
  lastPublicAt: string | null;
  lastRequestAt: string | null;
  budget: { per_minute: number; per_hour: number; per_day: number } | null;
  requests24h: number;
  unknownCostAttempts: number;
  pipeline: Record<string, number>;
  missingSources: number;
  daily: { key: string; state: 'published' | 'no-materials' | 'budget-waiting' | 'failed' | 'waiting'; candidates: number; checkedAt: string | null };
}

export async function loadAutomationOverview(now = new Date()): Promise<AutomationOverview | null> {
  const settings = await sql`SELECT key, value, updated_at FROM settings
    WHERE key IN ('agent-eval.auto-trial', 'agent-eval.auto-trial.last-tick', 'heartbeat.worker')`;
  const trial = settings.find(s => s.key === 'agent-eval.auto-trial')?.value;
  if (!trial || trial.version !== 1) return null;
  const heartbeat = settings.find(s => s.key === 'heartbeat.worker');
  const last = settings.find(s => s.key === 'agent-eval.auto-trial.last-tick')?.value;
  const retryAt = typeof last?.modelRetryAt === 'string' && Date.parse(last.modelRetryAt) > +now ? last.modelRetryAt : null;
  const window = dailyWindow(undefined, now);
  const key = window.key;
  const [diagnostic, preview, reports, budgets, usage, publicUpdate] = await Promise.all([
    trialDiagnostics(now), previewDaily(key),
    sql`SELECT 1 FROM reports WHERE kind = 'daily' AND key = ${key} AND ${reportContentSql()}`,
    sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'llm'`,
    sql`SELECT max(started_at) AS last_at, count(*) FILTER (WHERE started_at > ${new Date(+now - 86400000)})::int AS requests,
        count(*) FILTER (WHERE started_at >= ${trial.startedAt}::timestamptz AND (cost IS NULL OR currency IS NULL OR cost_basis IS NULL))::int AS unknown_cost
      FROM receipt_attempts WHERE service = 'llm' AND origin = 'live' AND started_at <= ${now}`,
    sql`SELECT max(greatest(p.updated_at, CASE WHEN p.selected THEN p.visible_after ELSE p.updated_at END)) AS at
      FROM publications p WHERE p.eligible AND ${listedCondition(now)}`,
  ]);
  const budget = budgets[0] as AutomationOverview['budget'];
  const alive = !!heartbeat && +now - +heartbeat.updated_at < 3 * 60000;
  const budgetChanged = !budget || ['per_minute', 'per_hour', 'per_day'].some(k => budget[k as keyof typeof budget] !== trial.budgetApplied?.[k]);
  const state: AutomationOverview['state'] = alive && heartbeat!.value.mode !== 'agent-eval-auto-trial' ? 'unexpected-worker'
    : trial.state === 'stopped' ? 'stopped' : Date.parse(trial.expiresAt) <= +now ? 'expired'
    : Date.parse(trial.startedAt) > +now ? 'not-started' : budgetChanged ? 'budget-changed'
    : !alive ? 'offline' : retryAt ? 'budget-waiting' : 'running';
  const collected = diagnostic.sourceHealth.map(s => s.last_ok_at as Date | null).filter((at): at is Date => !!at && at <= now);
  const reportCheck = last?.reportCheck;
  const dailyState: AutomationOverview['daily']['state'] = reports.length ? 'published' : !preview.entries.length ? 'no-materials'
    : retryAt ? 'budget-waiting' : reportCheck?.status === 'failed' && Date.parse(reportCheck.at) >= +window.end ? 'failed' : 'waiting';
  return { state, startedAt: trial.startedAt, expiresAt: trial.expiresAt, retryAt,
    lastTickAt: last?.at ?? null, lastCollectedAt: collected.length ? new Date(Math.max(...collected.map(Number))).toISOString() : null,
    lastPublicAt: publicUpdate[0]?.at?.toISOString() ?? null, lastRequestAt: usage[0]?.last_at?.toISOString() ?? null,
    budget: budget ?? null, requests24h: usage[0]!.requests, unknownCostAttempts: usage[0]!.unknown_cost,
    pipeline: { ...diagnostic.pipeline }, missingSources: diagnostic.missingSources.length,
    daily: { key, state: dailyState, candidates: preview.entries.length, checkedAt: reportCheck?.at ?? null } };
}

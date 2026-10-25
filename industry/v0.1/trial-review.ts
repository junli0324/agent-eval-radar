// Read-only trial evidence. Attempts include retries; no prompts, raw responses or credentials leave this tool.
import { fileURLToPath } from "node:url";
import { sql, closeDb } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/items";
import { reportContentSql } from "@aihot/backend/publication/report-content";
import { RECENT_SOURCES } from "./recent-policy.ts";

export async function trialReview(now = new Date()) {
  if (process.env.COLLECT_ENABLED !== "false" || process.env.MODEL_CALLS_ENABLED !== "false") {
    throw new Error("Review requires COLLECT_ENABLED=false and MODEL_CALLS_ENABLED=false");
  }
  return sql.begin("isolation level repeatable read read only", async tx => {
    const [setting] = await tx`SELECT value FROM settings WHERE key = 'agent-eval.auto-trial'`;
    const trial = setting?.value as { state: string; startedAt: string; expiresAt: string } | undefined;
    if (!trial) return { status: "not-prepared", checkedAt: now.toISOString(), modelCalls: 0 };
    const start = new Date(trial.startedAt), expiry = new Date(trial.expiresAt);
    if (!Number.isFinite(+start) || !Number.isFinite(+expiry) || +expiry <= +start) throw new Error("Invalid stored trial window");
    const [requests] = await tx`SELECT count(*)::int AS attempts,
        count(DISTINCT receipt_id)::int AS logical_requests,
        count(*) FILTER (WHERE started_at >= ${expiry})::int AS started_after_expiry,
        count(*) FILTER (WHERE started_at < ${expiry} AND finished_at >= ${expiry})::int AS finished_after_expiry,
        count(*) FILTER (WHERE status IN ('pending', 'unknown'))::int AS unresolved,
        count(*) FILTER (WHERE usage->>'total_tokens' IS NULL)::int AS unknown_token_attempts,
        coalesce(sum((usage->>'total_tokens')::bigint), 0) AS recorded_tokens,
        count(*) FILTER (WHERE cost IS NULL OR currency IS NULL OR cost_basis IS NULL)::int AS unknown_cost_attempts,
        max(started_at) AS last_request_at
      FROM receipt_attempts WHERE service = 'llm' AND origin = 'live' AND started_at >= ${start} AND started_at <= ${now}`;
    const costs = await tx`SELECT currency, cost_basis, count(*)::int AS attempts, sum(cost) AS amount
      FROM receipt_attempts WHERE service = 'llm' AND origin = 'live' AND started_at >= ${start} AND started_at <= ${now}
        AND cost IS NOT NULL AND currency IS NOT NULL AND cost_basis IS NOT NULL
      GROUP BY currency, cost_basis ORDER BY currency, cost_basis`;
    const steps = await tx`SELECT r.purpose, count(*)::int AS attempts,
        coalesce(sum((a.usage->>'total_tokens')::bigint), 0) AS recorded_tokens
      FROM receipt_attempts a JOIN receipts r ON r.id = a.receipt_id
      WHERE a.service = 'llm' AND a.origin = 'live' AND a.started_at >= ${start} AND a.started_at <= ${now}
      GROUP BY r.purpose ORDER BY attempts DESC, r.purpose`;
    const [publications] = await tx`SELECT count(*)::int AS readable,
        count(*) FILTER (WHERE p.selected AND NOT p.backfill)::int AS selected_live,
        count(*) FILTER (WHERE NOT p.selected AND NOT p.backfill)::int AS ordinary_live,
        count(*) FILTER (WHERE p.backfill)::int AS backfill
      FROM publications p WHERE p.source_id IN ${tx(RECENT_SOURCES)} AND p.updated_at >= ${start} AND p.updated_at <= ${now}
        AND p.eligible AND ${listedCondition(now)}`;
    const reports = await tx`SELECT kind, key, generated_at, origin,
        content #>> '{generator,mode}' AS mode, ${reportContentSql()} AS readable,
        jsonb_array_length(jsonb_path_query_array(content, '$.sections[*].items[*]'))
          + jsonb_array_length(jsonb_path_query_array(content, '$.themes[*].storyRefs[*]'))
          + jsonb_array_length(jsonb_path_query_array(content, '$.flashes[*]')) AS citations
      FROM reports WHERE generated_at <= ${now} ORDER BY generated_at DESC, kind, key LIMIT 12`;
    return { status: trial.state === "stopped" ? "stopped" : +now >= +expiry ? "expired" : +now < +start ? "not-started" : "active",
      checkedAt: now.toISOString(), window: { startedAt: start.toISOString(), expiresAt: expiry.toISOString() },
      requests, costs, steps, publications, reports, modelCalls: 0,
      notes: [
        "Requests cover all live llm attempts since trial start through this check, including retries and any other entry point. They are not exclusively attributed to this worker.",
        "Starts after expiry need review; a task already in flight may finish after expiry. This alone does not prove an unauthorized renewal.",
        "Unknown cost is not zero. Recorded costs stay separate by currency and actual/estimated basis; verify the provider bill.",
        "Publications are currently readable allowlisted items updated since trial start, not new-article totals or a quality score. Backfill is separate; release gates apply.",
        "Reports are the latest 12 stored issues across all dates, including empty placeholders and archival issues for diagnosis. Counts do not prove factual quality.",
      ] };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error("Use trial-review.ts without arguments");
    console.log(JSON.stringify(await trialReview(), null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Trial review failed"); process.exitCode = 1; }
  finally { await closeDb(); }
}

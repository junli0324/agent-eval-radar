import { setTimeout as delay } from "node:timers/promises";
import { sql, closeDb } from "@aihot/backend/db";
import { stopBoss, shutdownSignal } from "@aihot/backend/jobs/queue";
import { beat } from "@aihot/backend/operations/heartbeat";
import { TRIAL_LOCK, runTrialTick, trialStatus, verifyTrialModel } from "./auto-trial.ts";

let connection: Awaited<ReturnType<typeof sql.reserve>> | undefined;
let locked = false;
let heartbeat: NodeJS.Timeout | undefined;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdownSignal.abort());
try {
  if (process.env.AGENT_EVAL_AUTO_TRIAL !== 'true' || process.env.COLLECT_ENABLED !== 'true' || process.env.MODEL_CALLS_ENABLED !== 'true' || process.env.EMBEDDINGS_ENABLED !== 'false') throw new Error("Start with the committed auto-trial Compose override");
  connection = await sql.reserve();
  const [lock] = await connection`SELECT pg_try_advisory_lock(hashtext(${TRIAL_LOCK})) AS locked`;
  locked = !!lock!.locked;
  if (!locked) throw new Error("Another auto-trial worker is already running");
  let lastMaintenance = 0;
  while (!shutdownSignal.signal.aborted) {
    await verifyTrialModel();
    const status = await trialStatus();
    if (!status.trial?.active) { console.log(JSON.stringify({ status: 'trial-ended', trial: status.trial })); break; }
    await beat('worker', { mode: 'agent-eval-auto-trial', expiresAt: status.trial.expiresAt });
    if (!heartbeat) {
      const expiresAt = status.trial.expiresAt;
      heartbeat = setInterval(() => void beat('worker', { mode: 'agent-eval-auto-trial', expiresAt }).catch(() => {}), 60_000);
      heartbeat.unref();
    }
    const maintenance = Date.now() - lastMaintenance >= 5 * 60000;
    console.log(JSON.stringify(await runTrialTick({ maintenance })));
    if (maintenance) lastMaintenance = Date.now();
    await delay(60000, undefined, { signal: shutdownSignal.signal }).catch(() => {});
  }
} catch (error) { console.error(error instanceof Error ? error.message : 'Auto-trial stopped'); process.exitCode = 1; }
finally {
  if (heartbeat) clearInterval(heartbeat);
  if (locked) await connection!`SELECT pg_advisory_unlock(hashtext(${TRIAL_LOCK}))`;
  connection?.release();
  await stopBoss();
  await closeDb();
}

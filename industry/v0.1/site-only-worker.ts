// Refuse before importing configuration, database access or queue handlers.
console.error(JSON.stringify({ status: 'site-only-worker-disabled',
  reason: 'Reading mode has no worker. After separate authorization, append industry/v0.1/compose.auto-trial.yml to the root and site-only Compose files.' }));
process.exitCode = 1;

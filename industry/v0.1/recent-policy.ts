import { addDays, beijingDate, isValidDate } from "@aihot/contracts/time";

// Deliberately excludes broad feeds and the currently rate-limited arXiv endpoint.
export const RECENT_SOURCES = ["rss-inspect-ai", "rss-tau2-bench", "rss-deepeval", "rss-langfuse", "web-langchain-blog", "web-anthropic-research"];
export const RECENT_DAYS = 14;
export const damagedCopy = (v: unknown): boolean => typeof v === "string"
  ? /\?{2,}|\uFFFD/.test(v) : Array.isArray(v) && v.some(damagedCopy);

export function dailyWindow(date?: string, now = new Date()) {
  const today = beijingDate(now);
  const latest = now.getTime() >= Date.parse(`${today}T08:00:00+08:00`) ? today : addDays(today, -1);
  const key = date ?? latest;
  if (!isValidDate(key)) throw new Error("Use a valid --date=YYYY-MM-DD");
  const end = new Date(`${key}T08:00:00+08:00`);
  if (end.getTime() > now.getTime()) throw new Error("Daily window has not closed; wait until 08:00 Beijing time");
  return { key, start: new Date(end.getTime() - 86400000), end };
}

export function recentOptions(args: string[]) {
  const command = args[0] ?? "status";
  if (!["status", "collect", "extract", "analyze", "publish", "daily-preview", "daily"].includes(command)) throw new Error("Use status, collect, extract, analyze, publish, daily-preview or daily");
  let ids: string[] = [];
  let sources: string[] = [];
  let date: string | undefined;
  const seen = new Set<string>();
  for (const arg of args.slice(1)) {
    const key = arg.split("=")[0]!;
    if (seen.has(key)) throw new Error("Repeated option");
    seen.add(key);
    if (/^--ids=[a-zA-Z0-9_-]+(?:,[a-zA-Z0-9_-]+)*$/.test(arg)) ids = [...new Set(arg.slice(6).split(","))];
    else if (arg.startsWith("--sources=")) sources = [...new Set(arg.slice(10).split(","))];
    else if (arg.startsWith("--date=")) date = arg.slice(7);
    else throw new Error(`Unknown option: ${key}`);
  }
  const articleCommand = ["extract", "analyze", "publish"].includes(command);
  if (articleCommand ? ids.length < 1 || ids.length > 3 : seen.has("--ids")) throw new Error("Extract/analyze/publish require 1–3 explicit --ids; other commands do not accept ids");
  if (command === "collect" ? sources.length < 1 || sources.length > 3 || sources.some(s => !RECENT_SOURCES.includes(s)) : seen.has("--sources")) throw new Error("Collect requires 1–3 --sources from the recent-source allowlist");
  if (date !== undefined && (!["daily", "daily-preview"].includes(command) || !isValidDate(date))) throw new Error("--date is only a valid daily report date");
  return { command, ids, sources, date };
}

export function recentValves(command: string, env = process.env) {
  const collect = command === "collect" ? "true" : "false";
  const model = ["analyze", "daily"].includes(command) ? "true" : "false";
  if (env.COLLECT_ENABLED !== collect || env.MODEL_CALLS_ENABLED !== model) throw new Error(`This command requires COLLECT_ENABLED=${collect} and MODEL_CALLS_ENABLED=${model} for this process`);
}

export function assertRecent(a: { backfill: boolean; published_at: Date | null; discovered_at: Date }, now = new Date()) {
  const cutoff = now.getTime() - RECENT_DAYS * 86400000;
  if (a.backfill || !a.published_at || a.published_at.getTime() < cutoff || a.published_at.getTime() > now.getTime() || a.discovered_at.getTime() < cutoff) throw new Error("Not a dated, non-backfill candidate from the last 14 days");
}

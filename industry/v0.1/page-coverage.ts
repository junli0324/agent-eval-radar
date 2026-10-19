// Read the same public HTTP projections as visitors. No database writes or model calls.
import { fileURLToPath } from "node:url";
import { CATEGORIES } from "@aihot/industry/taxonomy";
import type { HotResponse, PoolResponse } from "@aihot/contracts/site";

interface Topic { slug: string; name: string; group: string; total: number }
export async function pageCoverage(base = process.env.API_BASE_URL ?? "http://127.0.0.1:3001") {
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Public API ${path}: HTTP ${response.status}`);
    return response.json() as Promise<T>;
  };
  const [pool, directory, hot, reports, categories] = await Promise.all([
    get<PoolResponse>("/api/site/pool"), get<{ topics: Topic[] }>("/api/site/topics"), get<HotResponse>("/api/site/hot"),
    Promise.all(["daily", "weekly", "monthly"].map(async kind => ({ kind, editions: (await get<{ items: unknown[] }>(`/api/site/reports/${kind}`)).items.length }))),
    Promise.all(CATEGORIES.map(async c => ({ category: c.key, name: c.label, articles: (await get<PoolResponse>(`/api/site/pool?category=${c.key}`)).total }))),
  ]);
  return { publicArticles: pool.total, categories, topics: directory.topics.map(t => ({ name: t.name, path: `/topics/${t.slug}`, selected: t.total })),
    hotEvents: hot.entries.length, reports, modelCalls: 0,
    note: "Public API counts only; report editions are the returned index length, not an all-time database total. Topic counts can include pending release; wait for the release gate and API cache. History fills reading pages, not current heat or daily reports." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await pageCoverage(), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Coverage check failed"); process.exitCode = 1; }
}

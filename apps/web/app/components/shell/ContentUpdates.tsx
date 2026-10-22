import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentUpdates as UpdateData } from "@aihot/contracts/site";
import { IconClock, IconChevronDown } from "../icons";
import { monthDayTime } from "../../lib/format";
import { getContentUpdatesSeen, KEYS, setContentUpdatesSeen } from "../../lib/local-state";

const REPORT_NAMES = { daily: "日报", weekly: "周报", monthly: "月报" };

/** A single poller in the public shell. Hidden tabs stop checking; failures keep the last good view. */
export function ContentUpdates() {
  const [data, setData] = useState<UpdateData | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const seen = useRef<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);

  const check = useCallback(async (force = false) => {
    if (document.visibilityState === "hidden" || pending.current || (!force && Date.now() - lastAttempt.current < 15_000)) return;
    seen.current = getContentUpdatesSeen() ?? seen.current;
    const baseline = seen.current;
    const controller = new AbortController();
    pending.current = controller; lastAttempt.current = Date.now(); setBusy(true);
    try {
      const response = await fetch(`/api/site/updates${baseline ? `?since=${encodeURIComponent(baseline)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) });
      if (!response.ok) throw new Error("Update check failed");
      const next = await response.json() as UpdateData;
      if (controller.signal.aborted || seen.current !== baseline) return;
      if (!baseline) { seen.current = next.checkedAt; setContentUpdatesSeen(next.checkedAt); }
      setData(next); setFailed(false);
    } catch { if (!controller.signal.aborted) setFailed(true); }
    finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }, []);

  useEffect(() => {
    void check(true);
    const timer = window.setInterval(() => void check(), 60_000);
    const focus = () => void check();
    const storage = (event: StorageEvent) => {
      if (event.key !== KEYS.contentUpdatesSeen && event.key !== null) return;
      pending.current?.abort(); pending.current = null;
      seen.current = getContentUpdatesSeen(); void check(true);
    };
    window.addEventListener("focus", focus);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", focus);
    return () => { window.clearInterval(timer); pending.current?.abort(); pending.current = null;
      window.removeEventListener("focus", focus); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", focus); };
  }, [check]);

  const acknowledge = () => {
    if (!data) return;
    seen.current = data.checkedAt; setContentUpdatesSeen(data.checkedAt);
    setData({ ...data, articles: 0, reports: 0 });
  };
  const unread = (data?.articles ?? 0) + (data?.reports ?? 0);
  return (
    <section aria-label="内容更新" className="mb-4 mt-3 rounded-control border border-line bg-surface lg:mt-0">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" aria-expanded={open} aria-controls="content-update-list" onClick={() => { if (!open) acknowledge(); setOpen(!open); }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] text-ink">
          <IconClock size={15} />
          <span className="font-medium">内容更新</span>
          <span role="status" className={unread ? "rounded-full bg-accent px-2 text-[12px] font-semibold text-accent-contrast" : "text-[12px] text-ink-4"}>
            {unread ? `${unread} 条未查看` : data ? "已查看当前更新" : failed ? "检查暂不可用" : "正在检查…"}
          </span>
          <IconChevronDown size={13} className={`ml-auto shrink-0 ${open ? "rotate-180" : ""}`} />
        </button>
        <button type="button" disabled={busy} onClick={() => void check(true)} className="shrink-0 border-l border-line pl-2 text-[12px] text-ink-3 hover:text-accent disabled:opacity-50">
          {busy ? "检查中…" : "检查更新"}
        </button>
      </div>
      {unread > 0 && <p className="px-3 pb-2 text-[12px] text-accent" aria-live="polite">自上次查看，{data!.articles} 篇文章、{data!.reports} 份报告有更新。</p>}
      {data && !unread && <p className="px-3 pb-2 text-[12px] text-ink-4">{data.latestAt ? `最近公开更新 ${monthDayTime(data.latestAt)}` : "暂无公开更新，后续会在这里提醒"}</p>}
      {failed && <p role="status" className="px-3 pb-2 text-[12px] text-ink-3">暂时无法检查，保留上次结果，稍后自动重试。</p>}
      {open && <div id="content-update-list" className="border-t border-line px-3 pb-3 pt-2">
        <p className="mb-2 text-[12px] leading-relaxed text-ink-4">最近 30 天的公开发布与修订，展示最新 12 条。打开此栏即标记当前更新已查看。</p>
        {data?.entries.length ? <ul className="divide-y divide-line-soft">{data.entries.map(entry => <li key={`${entry.kind}:${entry.key}`}>
          <a href={entry.href} className="block py-2 text-[13px] leading-relaxed text-ink hover:text-accent">
            <span className="mr-2 text-[11px] text-accent">{entry.kind === "article" ? entry.selected ? "精选" : "文章" : REPORT_NAMES[entry.kind]}</span>
            {entry.title}<time dateTime={entry.at} className="mt-0.5 block text-[11px] text-ink-4">站内更新于 {monthDayTime(entry.at)}</time>
          </a>
        </li>)}</ul> : <p className="py-2 text-[13px] text-ink-3">最近 30 天还没有公开更新。采集到的待处理内容不计入提醒。</p>}
        {data && <p className="mt-2 text-[11px] text-ink-4">最近检查 {monthDayTime(data.checkedAt)} · 页面打开时每分钟检查 · 查看记录仅存当前浏览器</p>}
      </div>}
    </section>
  );
}

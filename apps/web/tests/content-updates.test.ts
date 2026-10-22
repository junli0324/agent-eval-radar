import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import type { ContentUpdates as UpdateData } from "@aihot/contracts/site";

test("update notice persists acknowledgement, handles other tabs/offline/hidden pages and keeps links usable", async () => {
  const globals = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
  const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const fetchBefore = globalThis.fetch;
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const values = new Map<string, string>();
  const key = "agent-eval-radar-content-updates-seen-v1";
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, value: string) => values.set(k, value),
  } });
  Object.defineProperty(window.document, "visibilityState", { configurable: true, writable: true, value: "visible" });
  for (const [name, value] of Object.entries({ window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  let fail = false;
  const requests: string[] = [];
  const first = new Date(Date.now() - 60_000).toISOString();
  const next = new Date(Date.now() - 30_000).toISOString();
  let reply: UpdateData = { checkedAt: first, since: null, latestAt: null, articles: 0, reports: 0, entries: [] };
  globalThis.fetch = async input => {
    requests.push(String(input));
    return new Response(fail ? '{}' : JSON.stringify(reply), { status: fail ? 503 : 200, headers: { "content-type": "application/json" } });
  };
  const vite = await createServer({ configFile: false, root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true } });
  let root = createRoot(document.getElementById("root")!);
  const settle = async (action: () => void) => act(async () => { action(); await new Promise(resolve => setTimeout(resolve, 10)); });
  const click = async (label: string) => settle(() => {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent === label)!;
    assert.ok(button, label); button.dispatchEvent(new window.Event("click", { bubbles: true }));
  });
  try {
    const { ContentUpdates } = await vite.ssrLoadModule("/app/components/shell/ContentUpdates.tsx");
    await settle(() => root.render(createElement(ContentUpdates)));
    assert.equal(values.get(key), first); assert.doesNotMatch(document.body.textContent!, /条未查看/);
    reply = { ...reply, checkedAt: next, latestAt: next, articles: 1, reports: 1, entries: [
      { key: "agent", kind: "article", title: "Agent 评测更新", href: "/items/agent", selected: true, at: next },
      { key: "2026-W42", kind: "weekly", title: "评测周报", href: "/weekly/2026-W42", selected: false, at: next },
    ] };
    await click("检查更新");
    assert.ok(requests.at(-1)!.includes(encodeURIComponent(first))); assert.match(document.body.textContent!, /2 条未查看/);
    await settle(() => document.querySelector("button")!.dispatchEvent(new window.Event("click", { bubbles: true })));
    assert.equal(values.get(key), next); assert.doesNotMatch(document.body.textContent!, /条未查看/);
    assert.equal(document.querySelector('a[href="/items/agent"]')!.textContent!.includes("Agent 评测更新"), true);
    assert.ok(document.querySelector('a[href="/weekly/2026-W42"]'));
    fail = true; await click("检查更新");
    assert.match(document.body.textContent!, /暂时无法检查/); assert.ok(document.querySelector('a[href="/items/agent"]'));
    const count = requests.length;
    Object.defineProperty(document, "visibilityState", { value: "hidden" });
    await click("检查更新"); assert.equal(requests.length, count, "hidden pages do not poll");
    Object.defineProperty(document, "visibilityState", { value: "visible" });
    fail = false; reply = { ...reply, articles: 0, reports: 0 };
    const event = new window.Event("storage"); Object.defineProperty(event, "key", { value: key });
    await settle(() => window.dispatchEvent(event));
    assert.doesNotMatch(document.body.textContent!, /暂时无法检查|条未查看/);
    await settle(() => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await settle(() => root.render(createElement(ContentUpdates)));
    assert.ok(requests.at(-1)!.includes(encodeURIComponent(next)), "a reopened page uses the saved server watermark");
    assert.doesNotMatch(document.body.textContent!, /条未查看/);
  } finally {
    await settle(() => root.unmount()); await vite.close(); globalThis.fetch = fetchBefore;
    for (const name of globals) { const descriptor = original.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); }
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { fromInspectChangelog } from "@aihot/backend/sources/web-list";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";

const base = "https://inspect.aisi.org.uk/CHANGELOG.html";
const section = (version: string, body: string, anchor = "october-2026") =>
  `<section id="${anchor}" class="level2"><h2>${version} (06 October 2026)<a class="anchorjs-link" href="#${anchor}"></a></h2>${body}</section>`;

test("Inspect notes isolate a version, retain scoring fixes and sanitize its body", () => {
  const html = `<nav>${section("9.9.9", "menu")}</nav><main>` +
    section("0.3.277", '<ul><li>Fixed scored samples lost on cancellation.</li><li>Fixed exact() awarding an empty target a perfect score.</li></ul><script>bad()</script><p><a href="scorers.html">Scorers</a></p>') +
    section("0.3.276", "<p>A different version.</p>", "october-2026-1") + "</main>";
  const out = fromInspectChangelog(html, base);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.publishedAt?.toISOString(), "2026-10-06T00:00:00.000Z");
  assert.equal(out[0]!.bodyStatus, "ok");
  assert.match(out[0]!.bodyText!, /empty target a perfect score/);
  assert.doesNotMatch(out[0]!.bodyText!, /different version|menu|bad\(\)/);
  assert.match(out[0]!.bodyHtml!, /https:\/\/inspect\.aisi\.org\.uk\/scorers.html/);
  assert.equal(out[0]!.url, "https://github.com/UKGovernmentBEIS/inspect_ai/blob/0.3.277/CHANGELOG.md");
});

test("Inspect identities survive shifting date anchors and skip empty, undated and repeated sections", () => {
  const one = fromInspectChangelog(`<main>${section("0.3.277", "<p>Scoring fix.</p>")}</main>`, base)[0]!;
  const shifted = fromInspectChangelog(`<main>${section("0.3.277", "<p>Scoring fix.</p>", "october-2026-2")}</main>`, base)[0]!;
  assert.equal(one.identityKey, shifted.identityKey);
  assert.equal(one.url, shifted.url);
  const mixed = `<main>${section("0.3.277", "<p>Scoring fix.</p>")}${section("0.3.277", "duplicate")}` +
    section("0.3.276", "") + '<section class="level2"><h2>Unreleased</h2><p>Future plans.</p></section></main>';
  assert.equal(fromInspectChangelog(mixed, base).length, 1);
  assert.deepEqual(fromInspectChangelog("<main><h1>Sign in</h1></main>", base), []);
});

test("Inspect keeps a bounded ten-version collection window", () => {
  const html = `<main>${Array.from({ length: 20 }, (_, i) => section(`0.3.${300 - i}`, "<p>A fix.</p>")).join("")}</main>`;
  assert.equal(fromInspectChangelog(html, base).length, 10);
  assert.deepEqual(unsupportedConfig("web_list", { url: base, adapter: "inspect_changelog", _aihot: { initialBackfillLimit: 5 } }), []);
});

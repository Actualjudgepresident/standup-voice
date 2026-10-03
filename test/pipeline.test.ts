import assert from "node:assert/strict";
import { test } from "node:test";
import { createFixtureSource, normalizeConversation } from "../src/bee.ts";
import { parseWindow } from "../src/cli.ts";
import { rulesExtractor } from "../src/extract.ts";
import { fileIssues, issueBody, itemFingerprint } from "../src/github.ts";
import { renderStandup } from "../src/standup.ts";
import type { WorkItem } from "../src/types.ts";

const fixture = new URL("../fixtures/dev-day.json", import.meta.url).pathname;

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  kind: "task",
  title: "Fix the empty coupon crash",
  detail: "Checkout 500s on empty coupon.",
  area: "checkout",
  ownedByWearer: true,
  conversationId: 1,
  evidence: "said they would fix it",
  confidence: 0.9,
  ...over,
});

test("normalizeConversation flattens and orders utterances, drops empty text", () => {
  const c = normalizeConversation({
    id: 1,
    start_time: 0,
    transcriptions: [
      { utterances: [{ text: "second", speaker: "me", spoken_at: 20 }, { text: "  ", speaker: "me", spoken_at: 5 }] },
      { utterances: [{ text: "first", speaker: "", spoken_at: 10 }] },
    ],
  });
  assert.deepEqual(c.utterances.map((u) => [u.speaker, u.text]), [["unknown", "first"], ["me", "second"]]);
});

test("fixture source respects the time window", async () => {
  const src = createFixtureSource(fixture);
  assert.equal((await src.conversationsSince(Date.now() - parseWindow("24h"))).length, 4);
  assert.deepEqual((await src.conversationsSince(Date.now() - parseWindow("3h"))).map((c) => c.id), [9104]);
});

test("rules extractor finds owned tasks and skips non-engineering chatter", async () => {
  const conversations = await createFixtureSource(fixture).conversationsSince(0);
  const items = await rulesExtractor().extract(conversations);
  const titles = items.map((i) => i.title.toLowerCase());
  assert.ok(titles.some((t) => t.includes("exponential backoff")));
  assert.ok(!titles.some((t) => t.includes("groceries")));
  assert.ok(items.some((i) => i.kind === "blocker" && i.title.includes("audit log UI")));
});

test("fingerprint ignores punctuation and case, so reruns dedupe", () => {
  assert.equal(itemFingerprint(item()), itemFingerprint(item({ title: "fix the EMPTY coupon crash!" })));
  assert.notEqual(itemFingerprint(item()), itemFingerprint(item({ kind: "bug" })));
  assert.match(issueBody(item()), /<!-- standupbee:[0-9a-f]{12} -->/);
});

test("dry run plans issues without touching GitHub", async () => {
  const results = await fileIssues("acme/x", [item()], false);
  assert.deepEqual(results.map((r) => r.status), ["planned"]);
});

test("standup groups by section and credits teammates separately", () => {
  const md = renderStandup(
    [item(), item({ kind: "done", title: "Merged webhook check" }), item({ title: "Deploy events API", ownedByWearer: false })],
    [],
    new Date("2026-10-01T00:00:00Z"),
  );
  assert.match(md, /# Standup · 2026-10-01/);
  assert.match(md, /## Done\n- Merged webhook check/);
  assert.match(md, /## Next\n- Fix the empty coupon crash _\(checkout\)_/);
  assert.match(md, /## Blockers\n- None/);
  assert.match(md, /## Teammates took on\n- Deploy events API/);
});

test("parseWindow rejects junk", () => {
  assert.equal(parseWindow("90m"), 90 * 60_000);
  assert.throws(() => parseWindow("yesterday"));
});

test("issue footer names where the item came from", () => {
  assert.match(issueBody({ ...item(), source: "note" }), /from a spoken work note/);
  assert.doesNotMatch(issueBody({ ...item(), source: "note" }), /Bee/);
  const fromGithub = issueBody({ ...item(), source: "github", evidence: "Assigned issue #4" });
  assert.match(fromGithub, /\*\*Source:\*\* Assigned issue #4/);
  assert.doesNotMatch(fromGithub, /Confidence|speech-to-text/);
  // Batch-mode items from the Bee CLI carry no source.
  assert.match(issueBody(item({ conversationId: 9103 })), /from Bee conversation 9103/);
});

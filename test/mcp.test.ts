import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { intentAgent } from "../src/agent.ts";
import { rulesExtractor } from "../src/extract.ts";
import { createMcpServer } from "../src/mcp.ts";
import { createService } from "../src/service.ts";
import { renderSpokenStandup } from "../src/standup.ts";
import { Store } from "../src/store.ts";
import type { WorkItem } from "../src/types.ts";

let url: string;
let close: () => void;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "standup-"));
  const service = createService({ store: new Store(join(dir, "state.json")), extractor: rulesExtractor(), github: false });
  const handler = toNodeHandler(createMcpHandler(() => createMcpServer(service)));
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  close = () => server.close();
});
after(() => close());

async function client() {
  const c = new Client({ name: "test", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
}

type Items = { items: Array<{ id: string; kind: string; title: string; status: string }> };

test("MCP server lists the standup tools over Streamable HTTP", async () => {
  const c = await client();
  const { tools } = await c.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["add_note", "complete_item", "file_issue", "get_standup", "list_items"]);
  assert.equal(tools.find((t) => t.name === "get_standup")?.annotations?.readOnlyHint, true);
  await c.close();
});

test("note → standup → complete round trip", async () => {
  const c = await client();
  const added = (await c.callTool({ name: "add_note", arguments: { text: "I need to fix the flaky checkout test" } })).structuredContent as Items;
  assert.equal(added.items.length, 1);
  const id = added.items[0].id;

  const standup = (await c.callTool({ name: "get_standup", arguments: {} })).structuredContent as { spoken: string };
  assert.match(standup.spoken, /Today you're on Fix the flaky checkout test/);

  await c.callTool({ name: "complete_item", arguments: { id } });
  const after = (await c.callTool({ name: "get_standup", arguments: {} })).structuredContent as { spoken: string };
  assert.match(after.spoken, /Yesterday you finished: Fix the flaky checkout test/);
  assert.match(after.spoken, /Nothing's queued for today/);
  await c.close();
});

test("unknown id comes back as a tool error, not a crash", async () => {
  const c = await client();
  const res = await c.callTool({ name: "complete_item", arguments: { id: "nope" } });
  assert.equal(res.isError, true);
  await c.close();
});

test("offline voice agent routes blocker questions through MCP", async () => {
  const agent = intentAgent(url);
  await agent.ask("I'm blocked on the staging database credentials");
  const reply = await agent.ask("Anything blocking me?");
  assert.deepEqual(reply.trace.map((t) => t.name), ["list_items"]);
  assert.match(reply.speech, /1 open blocker/);
});

test("spoken standup caps each section and reads naturally", () => {
  const item = (kind: WorkItem["kind"], title: string): WorkItem => ({
    kind, title, detail: "", area: null, ownedByWearer: true, conversationId: 0, evidence: "", confidence: 1,
  });
  const spoken = renderSpokenStandup([
    item("done", "Merged: Add OAuth"), item("done", "Ship templates"), item("done", "Fix CSS"), item("done", "Write docs"),
    item("task", "Fix redirect"),
  ]);
  assert.equal(
    spoken,
    "Yesterday you finished 4 things: Add OAuth, Ship templates, Fix CSS, and 1 more. Today you're on Fix redirect. No blockers.",
  );
});

test("offline agent understands standup windows", async () => {
  const { standupDays } = await import("../src/agent.ts");
  assert.equal(standupDays("what did i do in the last two weeks"), 14);
  assert.equal(standupDays("last 3 days"), 3);
  assert.equal(standupDays("what did i do this week"), 7);
  assert.equal(standupDays("it's monday, what's my standup"), 3);
  assert.equal(standupDays("what's my standup"), undefined);
});

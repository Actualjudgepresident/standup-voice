import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { intentAgent } from "../src/agent.ts";

const PORT = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
const TOKEN = "test-key-123";
let proc: ReturnType<typeof spawn>;

before(async () => {
  proc = spawn(process.execPath, [new URL("../src/server.ts", import.meta.url).pathname], {
    env: {
      ...process.env,
      PORT: String(PORT),
      STANDUPBEE_TOKEN: TOKEN,
      STANDUPBEE_PUBLIC_HOST: "standup.example.test",
      STANDUPBEE_AGENT: "intents",
      STANDUPBEE_GITHUB: "0",
      STANDUPBEE_DATA: join(mkdtempSync(join(tmpdir(), "standup-")), "state.json"),
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});

after(() => proc.kill());

const ask = (headers: Record<string, string>) =>
  fetch(`${base}/api/ask`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ utterance: "what's my standup" }) });

test("public server rejects requests without the access key", async () => {
  assert.equal((await ask({})).status, 401);
  assert.equal((await ask({ Authorization: "Bearer wrong" })).status, 401);
  const mcp = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(mcp.status, 401);
});

test("public server answers with the access key, over MCP too", async () => {
  const res = await ask({ Authorization: `Bearer ${TOKEN}` });
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { trace: Array<{ name: string }> }).trace.map((t) => t.name), ["get_standup"]);
  const reply = await intentAgent(`${base}/mcp`, TOKEN).ask("I'm blocked on the deploy key");
  assert.deepEqual(reply.trace.map((t) => t.name), ["add_note"]);
});

test("unknown Host headers are refused", async () => {
  // fetch() drops custom Host headers, so use node:http directly.
  const status = await new Promise<number>((resolve, reject) =>
    request({ host: "127.0.0.1", port: PORT, path: "/healthz", headers: { Host: "evil.example" } }, (res) => resolve(res.statusCode ?? 0))
      .on("error", reject)
      .end(),
  );
  assert.equal(status, 403);
});

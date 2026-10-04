#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { timingSafeEqual } from "node:crypto";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { intentAgent, pickAgent, withFallback } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { pickExtractor, rulesExtractor, withFallbackExtractor } from "./extract.ts";
import { createMcpServer } from "./mcp.ts";
import { createService } from "./service.ts";
import { Store } from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_URL = `http://127.0.0.1:${PORT}/mcp`;
const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);
const AGENT = process.env.STANDUPBEE_AGENT ?? (hasClaude ? "anthropic" : "intents");
// Set when deployed behind a reverse proxy, e.g. standup.example.com.
const PUBLIC_HOST = process.env.STANDUPBEE_PUBLIC_HOST;
// Required bearer token for /mcp and /api/ask; needed for any public deploy.
const TOKEN = process.env.STANDUPBEE_TOKEN;
if (PUBLIC_HOST && !TOKEN) throw new Error("STANDUPBEE_PUBLIC_HOST needs STANDUPBEE_TOKEN: a public server must not run without auth");

const service = createService({
  store: new Store(process.env.STANDUPBEE_DATA ?? new URL("../data/state.json", import.meta.url).pathname),
  extractor: withFallbackExtractor(pickExtractor(process.env.STANDUPBEE_EXTRACTOR ?? (AGENT === "intents" ? "rules" : AGENT)), rulesExtractor()),
  github: process.env.STANDUPBEE_GITHUB !== "0",
  repo: process.env.STANDUPBEE_REPO,
});

// Stateless Streamable HTTP: a fresh McpServer per request over shared state.
const mcpHandler = toNodeHandler(createMcpHandler(() => createMcpServer(service)));
const agent: Agent = AGENT === "intents" ? intentAgent(MCP_URL, TOKEN) : withFallback(pickAgent(AGENT, MCP_URL, TOKEN), intentAgent(MCP_URL, TOKEN));
const hosts = ["localhost", "127.0.0.1", "[::1]", ...(PUBLIC_HOST ? [PUBLIC_HOST] : [])];
const validateHost = hostHeaderValidation(hosts);
const validateOrigin = originValidation(hosts);

function authorized(req: IncomingMessage): boolean {
  if (!TOKEN) return true;
  const given = Buffer.from(req.headers.authorization ?? "");
  const want = Buffer.from(`Bearer ${TOKEN}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
}

createServer(async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
    if (path === "/healthz") return void res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    if ((path === "/mcp" || path.startsWith("/api/")) && !authorized(req)) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" }).end(JSON.stringify({ error: "Missing or wrong access key" }));
      return;
    }
    if (path === "/mcp") return void mcpHandler(req, res);
    if (path === "/api/ask" && req.method === "POST") {
      const { utterance } = await body(req);
      if (typeof utterance !== "string" || !utterance.trim()) throw new Error("utterance is required");
      const reply = await agent.ask(utterance.trim());
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ...reply, agent: agent.name }));
      return;
    }
    if (path === "/" || path === "/index.html") {
      const html = await readFile(new URL("../web/index.html", import.meta.url), "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
      return;
    }
    res.writeHead(404).end("Not found");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${req.method} ${path}: ${message}`);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: message }));
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Standup voice app  http://localhost:${PORT}`);
  console.log(`MCP endpoint       ${MCP_URL}  (Streamable HTTP)`);
  console.log(`Agent: ${agent.name}${AGENT === "intents" ? "  (set STANDUPBEE_AGENT=bedrock or ANTHROPIC_API_KEY for Claude)" : ""}`);
  if (PUBLIC_HOST) console.log(`Public host        https://${PUBLIC_HOST}  (bearer token required)`);
});

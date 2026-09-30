#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { claudeAgent, intentAgent } from "./agent.ts";
import type { Agent } from "./agent.ts";
import { pickExtractor } from "./extract.ts";
import { createMcpServer } from "./mcp.ts";
import { createService } from "./service.ts";
import { Store } from "./store.ts";

const PORT = Number(process.env.PORT ?? 8787);
const MCP_URL = `http://127.0.0.1:${PORT}/mcp`;
const hasClaude = Boolean(process.env.ANTHROPIC_API_KEY);

const service = createService({
  store: new Store(process.env.STANDUPBEE_DATA ?? new URL("../data/state.json", import.meta.url).pathname),
  extractor: pickExtractor(process.env.STANDUPBEE_EXTRACTOR ?? (hasClaude ? "anthropic" : "rules")),
  github: process.env.STANDUPBEE_GITHUB !== "0",
  repo: process.env.STANDUPBEE_REPO,
});

// Stateless Streamable HTTP: a fresh McpServer per request over shared state.
const mcpHandler = toNodeHandler(createMcpHandler(() => createMcpServer(service)));
const agent: Agent = hasClaude ? claudeAgent(MCP_URL) : intentAgent(MCP_URL);
const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
}

createServer(async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) return;
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  try {
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
  console.log(`Agent: ${agent.name}${hasClaude ? "" : "  (set ANTHROPIC_API_KEY for the Claude agent)"}`);
});

import Anthropic from "@anthropic-ai/sdk";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export type ToolTrace = { name: string; args: Record<string, unknown>; result: string };
export type AgentReply = { speech: string; trace: ToolTrace[]; card: string | null };
export type Agent = { name: string; ask: (utterance: string) => Promise<AgentReply> };

type McpTool = { name: string; description?: string; inputSchema: Record<string, unknown> };
type CallResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

// Plays the Alexa+ role: an agent that discovers the standup tools over MCP
// (Streamable HTTP, the same way Alexa+ connects to third-party servers) and
// calls them to answer a spoken request.
async function connect(mcpUrl: string) {
  const client = new Client({ name: "standup-voice", version: "0.2.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  const { tools } = (await client.listTools()) as { tools: McpTool[] };
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as CallResult;
    const out = (res.content ?? []).map((c) => c.text ?? "").join("\n");
    return { text: res.isError ? `Error: ${out}` : out, structured: res.structuredContent ?? null };
  };
  return { client, tools, call };
}

const SYSTEM = `You are a voice assistant in the style of Alexa, helping a software engineer with their daily standup through the tools provided.
Your reply is read aloud: one to three short sentences, no markdown, no lists, no URLs, no item ids.
- For standup questions call get_standup and read its spoken text, lightly trimmed.
- When the engineer tells you about work they did, will do, are stuck on, or decided, call add_note with their words.
- To mark something done, find it with list_items first, then complete_item.
- Only call file_issue after the engineer has said yes to filing it.`;

export function claudeAgent(mcpUrl: string, model = process.env.STANDUPBEE_MODEL ?? "claude-opus-5-5"): Agent {
  const anthropic = new Anthropic();
  return {
    name: `claude:${model}`,
    async ask(utterance) {
      const mcp = await connect(mcpUrl);
      const trace: ToolTrace[] = [];
      let card: string | null = null;
      try {
        const tools: Anthropic.Tool[] = mcp.tools.map((t) => ({
          name: t.name,
          description: t.description ?? "",
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
        }));
        const messages: Anthropic.MessageParam[] = [{ role: "user", content: utterance }];
        for (let turn = 0; turn < 6; turn++) {
          const response = await anthropic.messages.create({
            model,
            max_tokens: 4000,
            system: SYSTEM,
            output_config: { effort: "low" },
            tools,
            messages,
          });
          messages.push({ role: "assistant", content: response.content });
          if (response.stop_reason !== "tool_use") {
            const speech = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
            return { speech: speech || "Sorry, I didn't catch that.", trace, card };
          }
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const block of response.content) {
            if (block.type !== "tool_use") continue;
            const args = block.input as Record<string, unknown>;
            const { text, structured } = await mcp.call(block.name, args);
            if (block.name === "get_standup" && typeof structured?.markdown === "string") card = structured.markdown;
            trace.push({ name: block.name, args, result: text });
            results.push({ type: "tool_result", tool_use_id: block.id, content: text, is_error: text.startsWith("Error:") });
          }
          messages.push({ role: "user", content: results });
        }
        return { speech: "That took more steps than I expected. Try asking again more simply.", trace, card };
      } finally {
        await mcp.client.close();
      }
    },
  };
}

const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, ten: 10, fourteen: 14 };

// "last 3 days", "two weeks", "this week", "since Friday"-style windows.
export function standupDays(u: string): number | undefined {
  const m = /\b(\d+|one|two|three|four|five|seven|ten|fourteen)\s+(day|week)s?\b/.exec(u);
  if (m) {
    const n = Number(m[1]) || NUMBERS[m[1]];
    return Math.min(14, m[2] === "week" ? n * 7 : n);
  }
  if (/\bfortnight\b/.test(u)) return 14;
  if (/\bweek\b/.test(u)) return 7;
  if (/\b(monday|weekend|friday)\b/.test(u)) return 3;
  return undefined;
}

// No-API-key fallback: keyword intents mapped straight onto the same MCP
// tools, so the voice demo and the MCP path still work offline.
export function intentAgent(mcpUrl: string): Agent {
  return {
    name: "intents",
    async ask(utterance) {
      const mcp = await connect(mcpUrl);
      const trace: ToolTrace[] = [];
      const run = async (name: string, args: Record<string, unknown>) => {
        const r = await mcp.call(name, args);
        trace.push({ name, args, result: r.text });
        return r;
      };
      try {
        const u = utterance.toLowerCase();
        if (/\b(standup|stand-up|yesterday|on my plate|what did i|what have i)\b/.test(u)) {
          const days = standupDays(u);
          const r = await run("get_standup", days ? { days } : {});
          return { speech: r.text, trace, card: typeof r.structured?.markdown === "string" ? r.structured.markdown : null };
        }
        if (/\bblock/.test(u) && /\?|what|any/.test(u)) {
          const r = await run("list_items", { kind: "blocker", status: "open" });
          const n = (r.structured?.items as unknown[] | undefined)?.length ?? 0;
          return { speech: n ? `You have ${n} open blocker${n === 1 ? "" : "s"}. ${r.text.replace(/- \[\w+\] blocker: /g, "")}` : "Nothing is blocking you.", trace, card: null };
        }
        const r = await run("add_note", { text: utterance });
        return { speech: r.text, trace, card: null };
      } finally {
        await mcp.client.close();
      }
    },
  };
}

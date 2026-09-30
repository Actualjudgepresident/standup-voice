import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import type { StandupService } from "./service.ts";
import { WORK_ITEM_KINDS } from "./types.ts";
import type { StoredItem } from "./types.ts";

const itemShape = z.object({
  id: z.string(),
  kind: z.enum(WORK_ITEM_KINDS),
  title: z.string(),
  area: z.string().nullable(),
  status: z.enum(["open", "completed"]),
  source: z.enum(["note", "github", "bee"]),
  url: z.string().nullable(),
});

const view = (i: StoredItem) => ({
  id: i.id,
  kind: i.kind,
  title: i.title,
  area: i.area,
  status: i.status,
  source: i.source,
  url: i.url,
});

const text = (t: string) => [{ type: "text" as const, text: t }];

export const INSTRUCTIONS = `Standup assistant for one software engineer. Answers "what's my standup", records spoken work notes, and tracks tasks, bugs, blockers and decisions. Data comes from the engineer's GitHub activity and the notes they dictate.
When answering by voice, read the "spoken" field of get_standup as-is; it is already written for speech. Ask before filing GitHub issues.`;

export function createMcpServer(service: StandupService): McpServer {
  const server = new McpServer({ name: "standup", version: "0.2.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "get_standup",
    {
      title: "Get my standup",
      description:
        "The engineer's daily standup: what they finished, what's next, blockers. Pulls fresh GitHub activity. Use for 'what's my standup', 'what did I do yesterday', 'what's on my plate'.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(14).optional().describe("Look-back window in days for finished work (default 1; use 3 on Mondays)"),
      }),
      outputSchema: z.object({ spoken: z.string(), markdown: z.string(), items: z.array(itemShape) }),
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => {
      const s = await service.standup(days ?? 1);
      const output = { spoken: s.spoken, markdown: s.markdown, items: s.items.map(view) };
      return { content: text(s.spoken), structuredContent: output };
    },
  );

  server.registerTool(
    "add_note",
    {
      title: "Record a work note",
      description:
        "Record something the engineer said about their work ('I need to fix the login redirect', 'blocked on the API keys', 'we decided to use Postgres'). Extracts tasks, bugs, blockers, done items and decisions and saves them.",
      inputSchema: z.object({ text: z.string().min(1).describe("What the engineer said, as close to verbatim as possible") }),
      outputSchema: z.object({ items: z.array(itemShape) }),
    },
    async ({ text: noteText }) => {
      const { items } = await service.addNote(noteText);
      const summary = items.length
        ? `Saved ${items.map((i) => `${i.kind}: ${i.title}`).join("; ")}.`
        : "Noted, but I didn't hear a task, bug, blocker or decision in that.";
      return { content: text(summary), structuredContent: { items: items.map(view) } };
    },
  );

  server.registerTool(
    "list_items",
    {
      title: "List work items",
      description: "List tracked work items, optionally by kind (task, bug, done, blocker, decision) or status. Use for 'what's blocking me', 'what bugs are open'.",
      inputSchema: z.object({
        kind: z.enum(WORK_ITEM_KINDS).optional(),
        status: z.enum(["open", "completed"]).optional(),
      }),
      outputSchema: z.object({ items: z.array(itemShape) }),
      annotations: { readOnlyHint: true },
    },
    async ({ kind, status }) => {
      const items = (await service.list({ kind, status })).map(view);
      const summary = items.length ? items.map((i) => `- [${i.id}] ${i.kind}: ${i.title}`).join("\n") : "Nothing matches.";
      return { content: text(summary), structuredContent: { items } };
    },
  );

  server.registerTool(
    "complete_item",
    {
      title: "Mark item done",
      description: "Mark a task, bug or blocker as done by id (from list_items or get_standup). It shows up under Done in the next standup.",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.object({ item: itemShape }),
      annotations: { idempotentHint: true },
    },
    async ({ id }) => {
      const item = view(await service.complete(id));
      return { content: text(`Marked done: ${item.title}`), structuredContent: { item } };
    },
  );

  server.registerTool(
    "file_issue",
    {
      title: "File a GitHub issue",
      description: "Create a GitHub issue for a task or bug by id. Confirm with the engineer first. Safe to repeat: an item already filed returns its existing issue.",
      inputSchema: z.object({ id: z.string(), repo: z.string().optional().describe("owner/name; defaults to the configured repo") }),
      outputSchema: z.object({ item: itemShape }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ id, repo }) => {
      const item = view(await service.fileIssue(id, repo));
      return { content: text(`Filed: ${item.url}`), structuredContent: { item } };
    },
  );

  return server;
}

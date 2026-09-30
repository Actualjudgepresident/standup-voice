---
name: standup
description: Give a software engineer their daily standup by voice, and record the work they talk about. Use when the user asks "what's my standup", "what did I do yesterday", "what's on my plate", "anything blocking me", or tells you about a task, bug, blocker or decision in their work.
---

# Standup

Voice-first standup assistant backed by the `standup` MCP server (Streamable HTTP).

## Connect

Run the server from the repo root, then point your agent at the MCP endpoint:

```bash
npm install && npm run serve
# MCP endpoint: http://127.0.0.1:8787/mcp
```

Claude Code: `claude mcp add --transport http standup http://127.0.0.1:8787/mcp`

## Tools

| Tool | Use for |
|---|---|
| `get_standup` | "What's my standup?" Pass `days: 3` on Mondays, `7` for "this week". |
| `add_note` | Anything the user says about their work: "I need to…", "I'm blocked on…", "we decided…", "I finished…". Pass their words as `text`. |
| `list_items` | "Anything blocking me?" → `kind: "blocker", status: "open"`. |
| `complete_item` | "I finished the redirect fix". Find the id with `list_items` first. |
| `file_issue` | Turn a task or bug into a GitHub issue. **Ask before calling.** |

## Speaking the answer

- Read `get_standup`'s `spoken` field as-is. It is already written for speech and kept to three items per section.
- Keep replies to one to three sentences, with no markdown, URLs or item ids.
- If a note produced nothing, say so briefly. Don't invent tasks.

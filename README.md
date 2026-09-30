# Standup Voice

**"Alexa, what's my standup?"** A voice standup assistant for engineers. Your standup is built from what you actually shipped on GitHub, plus the work you mention out loud during the day.

Built for the **Alexa+** track of *Build, Ship, Shape: Amazon Developer Hackathon*. It is:

- a self-hosted **MCP server** on **Streamable HTTP** (TypeScript SDK v2, MCP spec 2026-07-28, which is newer than the required 2025-11-25),
- an **Agent Skill** (`skill/standup/SKILL.md`) that teaches any agent when and how to use it,
- a **simulated Alexa+ web app**: you talk, an agent discovers the tools over MCP and calls them, and the answer is spoken back.

## How it works

```
 you (voice) ──▶ web app ──▶ agent (Claude, or offline intents)
                                 │  MCP over Streamable HTTP
                                 ▼
                       standup MCP server  /mcp
        get_standup · add_note · list_items · complete_item · file_issue
                 │                       │                    │
         GitHub activity         Claude extraction       GitHub issues
  (merged PRs, commits, closed,   of spoken notes into    (deduped, only
   assigned, review requests)     task/bug/blocker/...    when you say yes)
```

- **Done** comes from real activity: merged PRs, closed issues and commits since your last standup, each dated by when it happened.
- **Next** comes from assigned issues, review requests, and tasks you mentioned ("I need to fix the login redirect").
- **Blockers** come from what you say ("I'm blocked on the OAuth secret") and from your own PRs waiting on review for over a day.
- **Voice-first output**: `get_standup` returns a `spoken` version (three items per section, about 20 seconds) alongside markdown for the screen.

## Quick start

```bash
npm install
npm run serve            # http://localhost:8787  ·  MCP at http://127.0.0.1:8787/mcp
```

Open the page in Chrome or Safari, tap the ring and talk, or use the suggestion chips.

| Env var | |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the Claude agent and Claude note extraction. Without it, offline keyword intents run the same MCP tools. |
| `STANDUPBEE_EXTRACTOR` | `anthropic` · `bedrock` · `rules` |
| `AWS_REGION`, `STANDUPBEE_BEDROCK_MODEL` | Claude on Amazon Bedrock (default `anthropic.claude-opus-5-5`) |
| `GITHUB_TOKEN` | GitHub access; falls back to `gh auth token` |
| `STANDUPBEE_REPO` | Default `owner/name` for `file_issue` |
| `STANDUPBEE_GITHUB=0` | Turn off GitHub sync |

### Use it from any MCP client

```bash
claude mcp add --transport http standup http://127.0.0.1:8787/mcp
```

## Tests

```bash
npm test         # includes a real MCP client ↔ server round trip over HTTP
npm run typecheck
```

## Also included

`src/cli.ts` + `src/bee.ts` form a batch mode that reads conversations from a Bee wearable through `@beeai/cli`. It was built first, for the Bee track. It is kept because the extraction pipeline is shared (`npm run demo` runs it on a recorded sample day).

## Privacy

The server binds to localhost and checks Host/Origin headers. Notes go only to the model provider you configure, and nowhere at all with the offline extractor. Data lives in `data/state.json`.

# Devpost submission draft — Standup Voice

Paste each section into the matching Devpost field. Items marked TODO need you.

## Tagline
"Alexa, what's my standup?" Your daily standup, built from what you shipped on GitHub and what you said out loud.

## Track / mini challenges
- Primary: **Alexa+** (self-hosted MCP server on Streamable HTTP + Agent Skill + simulated Alexa+ web app)
- Open Source mini challenge: the repo is MIT-licensed. Only qualifies if we also ship a separate contribution (a fork or PR); otherwise leave it out.
- AWS Builder: only if Bedrock actually runs in the demo. Right now the IAM user has no Bedrock permissions, so leave it out unless that's fixed.

## Inspiration
Every engineer spends the 5 minutes before standup scrolling GitHub, Slack and their memory to answer "what did I do yesterday?". The answer is already in their activity log, plus the things they muttered out loud during the day ("I need to fix that redirect", "I'm blocked on the OAuth secret"). Voice is the natural interface for both: you capture notes hands-free while coding, and you hear your standup on the way to the meeting.

## What it does
- **"What's my standup?"** returns Done / Next / Blockers. Done comes from merged PRs, closed issues and commits since your last standup. Next comes from assigned issues, review requests and tasks you mentioned. Blockers come from what you said and from your own PRs that have waited on review for over a day.
- **"Note: I need to fix the login redirect"** extracts a task, bug, blocker, decision or done item and stores it.
- **"What's on my plate?" / "Mark the redirect done"** lists open items and completes them.
- **"File that as an issue"** creates a deduplicated GitHub issue, but only after you confirm.
- Output is voice-first: `get_standup` returns a ~20-second `spoken` script (three items per section) plus markdown for screens.

## How we built it
- **MCP server** (`src/mcp.ts`, `src/server.ts`): TypeScript MCP SDK v2, Streamable HTTP at `/mcp`, protocol spec 2026-07-28 (newer than the required 2025-11-25). It exposes five tools with zod input/output schemas and annotations: `get_standup`, `add_note`, `list_items`, `complete_item`, `file_issue`. It binds to localhost and validates Host/Origin.
- **Agent Skill** (`skill/standup/SKILL.md`): tells any agent when to call which tool and how to speak the result.
- **Simulated Alexa+ app** (`web/index.html`, `src/agent.ts`): browser speech recognition and synthesis. The agent connects as a real MCP client (`@modelcontextprotocol/client`), discovers the tools, and calls them. It uses Claude when a key is configured; otherwise a deterministic offline intent router drives the same MCP tools.
- **Extraction** (`src/extract.ts`): Claude (Anthropic API or Amazon Bedrock) turns free speech into typed work items, with a rules fallback.
- **GitHub** (`src/github.ts`, `src/activity.ts`): search API for PRs, issues, commits and review requests, each dated by when it happened.
- **Tests**: 13 tests, including a real MCP client ↔ server round trip over HTTP.

## Challenges
- We started on the Bee track, but Bee Developer Mode requires a paired Bee device, which we didn't have. We pivoted to Alexa+ and kept the shared extraction pipeline.
- GitHub commit search only indexes default branches, so feature-branch work shows up via PRs instead.
- Writing for the ear: we capped each section at three items and wrote the spoken script separately from the markdown.

## What we learned
MCP tool descriptions are the product surface. Rewording `get_standup`'s description to list real utterances ("what's on my plate") did more for routing than any code change.

## What's next
- A hosted deployment with OAuth, so a real Alexa+ integration can connect.
- Jira and Linear sources, and team standups that merge everyone's spoken notes.
- A Monday 3-day look-back by default (already supported via `days`).

## Built during the hackathon
All of it. The first commit (Bee batch mode) and the Alexa+ pivot (MCP server, web app, skill) were both written during the submission window, on 2026-09-30.

## Product feedback
- **MCP TypeScript SDK v2**: `registerTool` with zod schemas and `structuredContent` worked well. Finding the Streamable HTTP + Node adapter setup took digging, because the v1 → v2 package split (`server` / `node` / `client`) isn't obvious from older docs. I'd build with it again.
- **Alexa+ track docs**: the MCP requirement was clear. Before building, I wanted a way to test against a real Alexa+ client or an official simulator; without one, the "simulated web app" path involves guesswork about how Alexa+ chooses tools and reads responses.
- **Bee**: the CLI and docs looked good, but Developer Mode can't be tried without hardware, and the app has no skip or demo mode. That ended our Bee attempt.
- **Devpost**: the CAPTCHA on "Start project" blocks assisted workflows.

## Friction log (up to 10% bonus)
| Task | Steps | Expected | Actual | Severity | Workaround | Suggestion |
|---|---|---|---|---|---|---|
| Enable Bee Developer Mode | Installed Bee app, looked for Developer Mode | Use a demo account or sample data | Requires a paired Bee Pioneer device; no skip | Critical (blocked the track) | Switched to Alexa+ | Offer a sandbox account with recorded conversations |
| Test MCP server against Alexa+ | Searched the docs for an Alexa+ test client | A simulator or a way to register a dev MCP endpoint | None available to hackathon entrants | High | Built our own simulated Alexa+ web app | Publish an Alexa+ MCP test console |
| Set up Streamable HTTP in SDK v2 | Followed the README, then the package docs | One example wiring `McpServer` to Node HTTP | Examples spread across packages; v1 snippets fail | Medium | Read the SDK source | Add an end-to-end v2 Streamable HTTP example |
| Call Claude on Bedrock | Configured the AWS profile, invoked the model | Model access, or a clear error | AccessDenied for the IAM user; the console's model-access flow was unclear | Medium | Used offline intents | Make "request model access" a single step with the IAM policy shown |

## Feature requests
- Alexa+ MCP test console for developers — critical
- Bee sandbox/demo mode without hardware — important
- Official spoken-response guidelines for MCP tool output on Alexa+ — nice-to-have

## Links
- Repo: TODO (github.com/Actualjudgepresident/standup-voice once pushed)
- Video: TODO (YouTube, under 3 min)

# StandupBee

Your [Bee](https://www.bee.computer/) wearable hears the "I'll fix that later" moments. StandupBee turns spoken dev chatter into GitHub issues, Bee todos and a ready-to-read daily standup.

Built for the **Bee (Wearable AI)** track of *Build, Ship, Shape: Amazon Developer Hackathon*. It covers the developer-experience and personal-productivity priorities.

## How it works

```
Bee wearable ──▶ bee CLI (@beeai/cli/lib) ──▶ conversations + transcripts
                                                   │
                     Claude (Anthropic API or Amazon Bedrock), structured output
                                                   ▼
                  work items: task · bug · done · blocker · decision
                     │                 │                     │
            GitHub issues (deduped)   Bee todos         standup.md
```

1. **Read**: pulls the last N hours of conversations, with transcripts, through the official Bee CLI library.
2. **Extract**: Claude reads the transcripts and returns typed work items as schema-validated JSON (`messages.parse` + Zod). It separates what *you* committed to from what teammates took on, ignores small talk, and flags identifiers that speech-to-text may have misheard.
3. **Act**: your tasks and bugs become GitHub issues. Each one carries a hidden fingerprint, so rerunning never files duplicates. Optionally, they're also pushed back to Bee as todos.
4. **Report**: writes a Done / Next / Blockers / Decisions standup to `out/standup.md`.

Everything is a dry run until you pass `--apply`.

## Quick start

```bash
npm install
npm run demo          # sample dev day, offline rules extractor, no keys needed
npm test
```

With real Bee data (Bee app → Settings → tap the version 5× for Developer Mode):

```bash
npx bee login
export ANTHROPIC_API_KEY=...                  # or use Bedrock, below
node src/cli.ts run --since 24h --repo you/your-repo            # dry run
node src/cli.ts run --since 24h --repo you/your-repo --apply --bee-todos
```

### Amazon Bedrock (AWS Builder mini-challenge)

```bash
export AWS_REGION=us-east-1
node src/cli.ts run --extractor bedrock
```

This uses your normal AWS credential chain and the model `anthropic.claude-opus-5-5` (override with `STANDUPBEE_BEDROCK_MODEL`). Your IAM user needs Bedrock invoke permissions.

## Options

| Flag | Default | |
|---|---|---|
| `--source` | `bee` | `bee`, `fixtures`, or a path to a JSON day recording |
| `--since` | `24h` | `90m`, `24h`, `2d` |
| `--extractor` | `anthropic` | `anthropic`, `bedrock`, `rules` (offline) |
| `--min-confidence` | `0.5` | drop weaker LLM items |
| `--repo` | `$STANDUPBEE_REPO` | GitHub `owner/name` |
| `--apply` | off | actually create issues / todos |
| `--bee-todos` | off | push your tasks back to Bee |
| `--out` | `out` | where `standup.md` and `items.json` go |

GitHub auth uses `GITHUB_TOKEN`, falling back to `gh auth token`.

## Privacy

Transcripts go only to the model provider you pick. The offline `rules` extractor sends nothing anywhere. Issues contain a paraphrase of what was said, never the raw transcript.

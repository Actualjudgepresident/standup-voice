#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createCliSource, createFixtureSource } from "./bee.ts";
import type { BeeSource } from "./bee.ts";
import { pickExtractor } from "./extract.ts";
import { fileIssues } from "./github.ts";
import type { IssueResult } from "./github.ts";
import { renderStandup } from "./standup.ts";

const USAGE = `standupbee run [options]

  --source <bee|fixtures|path.json>   Where conversations come from (default: bee)
  --since <24h|90m|2d>                Look-back window (default: 24h)
  --extractor <anthropic|bedrock|rules>
                                      Default: $STANDUPBEE_EXTRACTOR or anthropic
  --min-confidence <0-1>              Drop weaker items (default: 0.5; rules ignores it)
  --repo <owner/name>                 GitHub repo for issues (default: $STANDUPBEE_REPO)
  --apply                             Actually create issues / Bee todos (default: dry run)
  --bee-todos                         Also push your tasks back to Bee as todos
  --out <dir>                         Where to write standup.md + items.json (default: out)
`;

export function parseWindow(value: string): number {
  const m = /^(\d+)\s*([mhd])$/.exec(value.trim());
  if (!m) throw new Error(`Bad --since "${value}" (use e.g. 90m, 24h, 2d)`);
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as "m" | "h" | "d"];
  return Number(m[1]) * unit;
}

function pickSource(name: string): BeeSource {
  if (name === "bee") return createCliSource();
  if (name === "fixtures") return createFixtureSource(new URL("../fixtures/dev-day.json", import.meta.url).pathname);
  return createFixtureSource(name);
}

async function run(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string", default: "bee" },
      since: { type: "string", default: "24h" },
      extractor: { type: "string", default: process.env.STANDUPBEE_EXTRACTOR ?? "anthropic" },
      "min-confidence": { type: "string", default: "0.5" },
      repo: { type: "string", default: process.env.STANDUPBEE_REPO },
      apply: { type: "boolean", default: false },
      "bee-todos": { type: "boolean", default: false },
      out: { type: "string", default: "out" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const source = pickSource(values.source);
  const extractor = pickExtractor(values.extractor);
  const since = Date.now() - parseWindow(values.since);
  const log = (msg: string) => console.error(`› ${msg}`);

  log(`reading conversations from ${source.name} since ${new Date(since).toLocaleString()}`);
  const conversations = await source.conversationsSince(since);
  log(`${conversations.length} conversations, ${conversations.reduce((n, c) => n + c.utterances.length, 0)} utterances`);

  log(`extracting work items with ${extractor.name}`);
  const minConfidence = extractor.name === "rules" ? 0 : Number(values["min-confidence"]);
  const items = (await extractor.extract(conversations)).filter((i) => i.confidence >= minConfidence);
  log(`${items.length} work items`);

  const actionable = items.filter((i) => i.ownedByWearer && (i.kind === "task" || i.kind === "bug"));
  let issues: IssueResult[] = [];
  if (values.repo) {
    issues = await fileIssues(values.repo, actionable, values.apply);
    for (const r of issues) {
      log(`${r.status === "planned" ? "would file" : r.status}: ${r.item.title}${r.url ? ` → ${r.url}` : ""}`);
    }
  } else {
    log("no --repo given, skipping GitHub issues");
  }

  if (values["bee-todos"]) {
    if (!source.createTodo) {
      log(`${source.name} does not support todos, skipping`);
    } else {
      for (const item of actionable) {
        if (values.apply) await source.createTodo(item.title);
        log(`${values.apply ? "added" : "would add"} Bee todo: ${item.title}`);
      }
    }
  }
  if (!values.apply && (values.repo || values["bee-todos"])) log("dry run; pass --apply to write");

  const standup = renderStandup(items, issues);
  await mkdir(values.out, { recursive: true });
  await writeFile(join(values.out, "standup.md"), standup);
  await writeFile(join(values.out, "items.json"), JSON.stringify(items, null, 2));
  console.log(standup);
}

const [command, ...rest] = process.argv.slice(2);
if (import.meta.main) {
  if (command === "run") {
    run(rest).catch((err: unknown) => {
      console.error(`standupbee: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
  } else {
    console.log(USAGE);
    process.exit(command ? 1 : 0);
  }
}

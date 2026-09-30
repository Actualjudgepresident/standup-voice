import type { IssueResult } from "./github.ts";
import type { WorkItem } from "./types.ts";

function bullet(item: WorkItem, links: Map<WorkItem, string>): string {
  const link = links.get(item);
  const area = item.area ? ` _(${item.area})_` : "";
  return `- ${item.title}${area}${link ? ` [issue](${link})` : ""}`;
}

// Classic three-question standup, built only from what was actually said.
export function renderStandup(items: WorkItem[], issues: IssueResult[] = [], date = new Date()): string {
  const links = new Map(issues.filter((r) => r.url).map((r) => [r.item, r.url as string]));
  const mine = items.filter((i) => i.ownedByWearer);
  const section = (title: string, list: WorkItem[], empty: string) => [
    `## ${title}`,
    ...(list.length ? list.map((i) => bullet(i, links)) : [`- ${empty}`]),
    "",
  ];
  const decisions = items.filter((i) => i.kind === "decision");
  const teammateAsks = items.filter((i) => !i.ownedByWearer && (i.kind === "task" || i.kind === "bug"));

  return [
    `# Standup · ${date.toISOString().slice(0, 10)}`,
    "",
    ...section("Done", mine.filter((i) => i.kind === "done"), "Nothing reported finished"),
    ...section("Next", mine.filter((i) => i.kind === "task" || i.kind === "bug"), "No new commitments heard"),
    ...section("Blockers", items.filter((i) => i.kind === "blocker"), "None"),
    ...(decisions.length ? section("Decisions", decisions, "") : []),
    ...(teammateAsks.length ? section("Teammates took on", teammateAsks, "") : []),
  ].join("\n");
}

function spokenList(items: WorkItem[], max = 3): string {
  const titles = items.slice(0, max).map((i) => i.title.replace(/^(Merged|Closed): /, ""));
  if (items.length > max) return `${titles.join(", ")}, and ${items.length - max} more`;
  if (titles.length === 1) return titles[0];
  return `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

// Voice-first version for Alexa: short sentences, no markdown, at most three
// items per section so it stays under ~20 seconds of speech.
export function renderSpokenStandup(items: WorkItem[]): string {
  const mine = items.filter((i) => i.ownedByWearer);
  const done = mine.filter((i) => i.kind === "done");
  const next = mine.filter((i) => i.kind === "task" || i.kind === "bug");
  const blockers = items.filter((i) => i.kind === "blocker");
  const parts: string[] = [];
  parts.push(done.length ? `Yesterday you ${done.length === 1 ? "finished" : `finished ${done.length} things`}: ${spokenList(done)}.` : "I didn't find anything finished since your last standup.");
  parts.push(next.length ? `Today you're on ${spokenList(next)}.` : "Nothing's queued for today yet.");
  parts.push(blockers.length ? `Heads up, ${blockers.length === 1 ? "one blocker" : `${blockers.length} blockers`}: ${spokenList(blockers, 2)}.` : "No blockers.");
  return parts.join(" ");
}

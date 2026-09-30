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

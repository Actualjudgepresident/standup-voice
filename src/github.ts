import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { WorkItem } from "./types.ts";

export type IssueResult = { item: WorkItem; url: string | null; status: "created" | "exists" | "planned" };

// Stable marker so re-running on the same day never files duplicates.
export function itemFingerprint(item: WorkItem): string {
  const basis = `${item.kind}|${item.title.toLowerCase().replace(/\W+/g, " ").trim()}`;
  return createHash("sha256").update(basis).digest("hex").slice(0, 12);
}

export function issueBody(item: WorkItem): string {
  return [
    item.detail,
    "",
    `**Heard:** ${item.evidence}`,
    item.area ? `**Area:** ${item.area}` : null,
    `**Confidence:** ${Math.round(item.confidence * 100)}%`,
    "",
    `<sub>Filed by StandupBee from Bee conversation ${item.conversationId}. Transcripts are speech-to-text, so double-check names and identifiers.</sub>`,
    `<!-- standupbee:${itemFingerprint(item)} -->`,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function githubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("No GitHub credentials: set GITHUB_TOKEN or run `gh auth login`.");
  }
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${init?.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function fileIssues(repo: string, items: WorkItem[], apply: boolean): Promise<IssueResult[]> {
  if (!apply) return items.map((item) => ({ item, url: null, status: "planned" }));
  const token = githubToken();
  // One listing of open StandupBee issues, then match fingerprints locally.
  const open = await gh<Array<{ body: string | null; html_url: string }>>(
    token,
    `/repos/${repo}/issues?state=open&labels=standupbee&per_page=100`,
  );
  const results: IssueResult[] = [];
  for (const item of items) {
    const marker = `standupbee:${itemFingerprint(item)}`;
    const existing = open.find((i) => i.body?.includes(marker));
    if (existing) {
      results.push({ item, url: existing.html_url, status: "exists" });
      continue;
    }
    const created = await gh<{ html_url: string }>(token, `/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: item.title,
        body: issueBody(item),
        labels: ["standupbee", item.kind === "bug" ? "bug" : "task"],
      }),
    });
    results.push({ item, url: created.html_url, status: "created" });
  }
  return results;
}

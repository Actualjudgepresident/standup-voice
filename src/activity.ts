import { githubToken } from "./github.ts";
import type { WorkItem } from "./types.ts";

type SearchIssue = {
  title: string;
  html_url: string;
  number: number;
  repository_url: string;
  pull_request?: { merged_at: string | null };
  closed_at: string | null;
  created_at: string;
};
type SearchCommit = {
  sha: string;
  html_url: string;
  commit: { message: string; committer: { date: string } };
  repository: { full_name: string };
};

async function search<T>(token: string, kind: "issues" | "commits", q: string): Promise<T[]> {
  const res = await fetch(`https://api.github.com/search/${kind}?q=${encodeURIComponent(q)}&per_page=30`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub search failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { items: T[] }).items;
}

const repoOf = (url: string) => url.replace("https://api.github.com/repos/", "");

export type ActivityItem = { item: WorkItem; url: string; at: number };

// Real "what did I do" data without any wearable: merged PRs, closed issues
// and commits become Done; assigned issues and review requests become Next;
// your own PRs still open for over a day read as waiting on review.
export async function githubActivity(sinceMs: number, now = Date.now()): Promise<ActivityItem[]> {
  const token = githubToken();
  const day = new Date(sinceMs).toISOString().slice(0, 10);
  const staleBefore = now - 86_400_000;
  const [merged, closed, commits, assigned, reviews, mineOpen] = await Promise.all([
    search<SearchIssue>(token, "issues", `author:@me is:pr is:merged merged:>=${day}`),
    search<SearchIssue>(token, "issues", `assignee:@me is:issue is:closed closed:>=${day}`),
    search<SearchCommit>(token, "commits", `author:@me committer-date:>=${day}`),
    search<SearchIssue>(token, "issues", `assignee:@me is:issue is:open`),
    search<SearchIssue>(token, "issues", `review-requested:@me is:pr is:open`),
    search<SearchIssue>(token, "issues", `author:@me is:pr is:open`),
  ]);

  const base = { detail: "", ownedByWearer: true, conversationId: 0, confidence: 1 };
  const out: ActivityItem[] = [];
  const add = (kind: WorkItem["kind"], title: string, area: string, url: string, evidence: string, at: string | null) =>
    out.push({ item: { ...base, kind, title, area, evidence, detail: evidence }, url, at: at ? Date.parse(at) : now });

  for (const pr of merged) add("done", `Merged: ${pr.title}`, repoOf(pr.repository_url), pr.html_url, `PR #${pr.number} merged`, pr.closed_at);
  for (const is of closed) add("done", `Closed: ${is.title}`, repoOf(is.repository_url), is.html_url, `Issue #${is.number} closed`, is.closed_at);
  // Commits already covered by a merged PR are noise; keep the rest, one line
  // each, first line of the message only.
  const seen = new Set<string>();
  for (const c of commits) {
    const subject = c.commit.message.split("\n")[0].trim();
    if (!subject || /^merge /i.test(subject) || seen.has(subject)) continue;
    seen.add(subject);
    add("done", subject, c.repository.full_name, c.html_url, `Commit ${c.sha.slice(0, 7)}`, c.commit.committer.date);
  }
  for (const is of assigned) add("task", is.title, repoOf(is.repository_url), is.html_url, `Assigned issue #${is.number}`, is.created_at);
  for (const pr of reviews) add("task", `Review: ${pr.title}`, repoOf(pr.repository_url), pr.html_url, `Review requested on PR #${pr.number}`, pr.created_at);
  for (const pr of mineOpen) {
    const created = Date.parse(pr.created_at);
    if (created < staleBefore) add("blocker", `Waiting on review: ${pr.title}`, repoOf(pr.repository_url), pr.html_url, `PR #${pr.number} open since ${new Date(created).toDateString()}`, pr.created_at);
  }
  return out;
}

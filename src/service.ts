import { githubActivity } from "./activity.ts";
import { fileIssues } from "./github.ts";
import { renderSpokenStandup, renderStandup } from "./standup.ts";
import { Store } from "./store.ts";
import type { Extractor, StoredItem } from "./types.ts";

const DAY = 86_400_000;

export type StandupService = ReturnType<typeof createService>;

// Everything the MCP tools do, independent of MCP so it is easy to test.
export function createService(opts: { store: Store; extractor: Extractor; github: boolean; repo?: string }) {
  const { store, extractor } = opts;
  let lastSync = { at: 0, since: Infinity };

  // GitHub search is rate limited, so reuse a sync from the last minute unless
  // this request looks further back than that sync did.
  async function syncGithub(sinceMs: number) {
    if (!opts.github) return;
    if (Date.now() - lastSync.at < 60_000 && lastSync.since <= sinceMs) return;
    lastSync = { at: Date.now(), since: sinceMs };
    const activity = await githubActivity(sinceMs);
    await store.upsert(activity.map((a) => a.item), "github", activity.map((a) => a.url), activity.map((a) => a.at));
  }

  return {
    async addNote(text: string) {
      const note = await store.addNote(text);
      const items = await extractor.extract([
        { id: note.id, startTime: note.createdAt, endTime: null, summary: null, utterances: [{ speaker: "me", text, spokenAt: note.createdAt }] },
      ]);
      return { note, items: await store.upsert(items, "note") };
    },

    async standup(days = 1) {
      const since = Date.now() - days * DAY;
      await syncGithub(since);
      // Done items only count inside the window; open work carries over.
      const all = await store.items();
      const items = all.filter((i) => (i.kind === "done" ? i.createdAt >= since : i.status === "open"));
      return { items, spoken: renderSpokenStandup(items), markdown: renderStandup(items, items.filter((i) => i.url).map((i) => ({ item: i, url: i.url, status: "exists" as const }))) };
    },

    async list(filter: { kind?: StoredItem["kind"]; status?: StoredItem["status"] } = {}) {
      return (await store.items({ status: filter.status })).filter((i) => !filter.kind || i.kind === filter.kind);
    },

    async complete(id: string) {
      const item = await store.update(id, { status: "completed" });
      // Finishing a task is itself a Done item for tomorrow's standup.
      await store.upsert([{ ...item, kind: "done", title: item.title }], item.source, [item.url]);
      return item;
    },

    async fileIssue(id: string, repo = opts.repo) {
      if (!repo) throw new Error("No repo configured: pass repo or set STANDUPBEE_REPO");
      const item = await store.get(id);
      if (!item) throw new Error(`No item with id ${id}`);
      if (item.url) return item;
      const [result] = await fileIssues(repo, [item], true);
      return store.update(id, { url: result.url });
    },
  };
}

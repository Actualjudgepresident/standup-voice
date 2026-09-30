import { readFile } from "node:fs/promises";
import { createBeeClient } from "@beeai/cli/lib";
import type { Conversation, Utterance } from "./types.ts";

export type BeeSource = {
  name: string;
  conversationsSince: (sinceMs: number) => Promise<Conversation[]>;
  // Optional write-back so extracted tasks show up on the wearer's Bee.
  createTodo?: (text: string) => Promise<void>;
};

type RawUtterance = { text?: string; speaker?: string; spoken_at?: number | null; start?: number | null };
type RawConversation = {
  id: number;
  start_time: number;
  end_time?: number | null;
  summary?: string | null;
  transcriptions?: Array<{ utterances?: RawUtterance[] }>;
};
type ListResponse = { conversations?: RawConversation[]; next_cursor?: string | null };
type DetailResponse = { conversation?: RawConversation } & Partial<RawConversation>;

export function normalizeConversation(raw: RawConversation): Conversation {
  const utterances: Utterance[] = (raw.transcriptions ?? [])
    .flatMap((t) => t.utterances ?? [])
    .map((u) => ({
      speaker: u.speaker || "unknown",
      text: (u.text ?? "").trim(),
      spokenAt: u.spoken_at ?? u.start ?? null,
    }))
    .filter((u) => u.text.length > 0)
    .sort((a, b) => (a.spokenAt ?? 0) - (b.spokenAt ?? 0));
  return {
    id: raw.id,
    startTime: raw.start_time,
    endTime: raw.end_time ?? null,
    summary: raw.summary ?? null,
    utterances,
  };
}

// Reads the wearer's real Bee data through the official `bee` CLI (must be
// logged in: `npx bee login`).
export function createCliSource(command?: string): BeeSource {
  const bee = createBeeClient(command ? { command } : {});
  return {
    name: "bee",
    async conversationsSince(sinceMs) {
      const summaries: RawConversation[] = [];
      let cursor: string | undefined;
      // The list is newest-first; stop paging once we pass the window.
      for (let page = 0; page < 20; page++) {
        const res = await bee.api.conversations.list<ListResponse>({ limit: 20, cursor });
        const batch = res.conversations ?? [];
        summaries.push(...batch.filter((c) => c.start_time >= sinceMs));
        const reachedOlder = batch.some((c) => c.start_time < sinceMs);
        if (reachedOlder || !res.next_cursor || batch.length === 0) break;
        cursor = res.next_cursor;
      }
      const details = await Promise.all(
        summaries.map(async (s) => {
          const res = await bee.api.conversations.get<DetailResponse>(s.id);
          return normalizeConversation(res.conversation ?? (res as RawConversation));
        }),
      );
      return details.sort((a, b) => a.startTime - b.startTime);
    },
    async createTodo(text) {
      await bee.api.todos.create({ text });
    },
  };
}

// Replays a recorded day from JSON, in the same shape the Bee API returns.
// Lets the pipeline run (and be demoed) without a device.
export function createFixtureSource(path: string): BeeSource {
  return {
    name: `fixture:${path}`,
    async conversationsSince(sinceMs) {
      const raw = JSON.parse(await readFile(path, "utf8")) as { conversations: RawConversation[] };
      // Fixtures store times relative to "now" (negative ms offsets) so demos
      // always look like today.
      const now = Date.now();
      return raw.conversations
        .map((c) => ({
          ...c,
          start_time: c.start_time <= 0 ? now + c.start_time : c.start_time,
          transcriptions: c.transcriptions?.map((t) => ({
            utterances: t.utterances?.map((u) => ({
              ...u,
              spoken_at: u.spoken_at != null && u.spoken_at <= 0 ? now + u.spoken_at : u.spoken_at,
            })),
          })),
        }))
        .filter((c) => c.start_time >= sinceMs)
        .map(normalizeConversation)
        .sort((a, b) => a.startTime - b.startTime);
    },
  };
}

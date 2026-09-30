import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { itemFingerprint } from "./github.ts";
import type { ItemSource, StoredItem, WorkItem } from "./types.ts";

export type Note = { id: number; text: string; createdAt: number };
type State = { items: StoredItem[]; notes: Note[] };

// A single JSON file is plenty for one person's standup history, and keeps
// the MCP server trivially self-hostable.
export class Store {
  private path: string;
  private state: State | null = null;

  constructor(path: string) {
    this.path = path;
  }

  private async load(): Promise<State> {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await readFile(this.path, "utf8")) as State;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      this.state = { items: [], notes: [] };
    }
    return this.state;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2));
    await rename(tmp, this.path);
  }

  async addNote(text: string, now = Date.now()): Promise<Note> {
    const state = await this.load();
    const note = { id: (state.notes.at(-1)?.id ?? 0) + 1, text, createdAt: now };
    state.notes.push(note);
    await this.save();
    return note;
  }

  // Upserts by fingerprint: the same task heard twice, or the same PR synced
  // twice, stays one item. Returns the stored versions.
  async upsert(items: WorkItem[], source: ItemSource, urls: (string | null)[] = [], times: number[] = [], now = Date.now()) {
    const state = await this.load();
    const out: StoredItem[] = [];
    items.forEach((item, i) => {
      const id = itemFingerprint(item);
      const existing = state.items.find((s) => s.id === id);
      if (existing) {
        Object.assign(existing, item, { url: urls[i] ?? existing.url });
        out.push(existing);
        return;
      }
      const stored: StoredItem = { ...item, id, source, status: "open", createdAt: times[i] ?? now, url: urls[i] ?? null };
      state.items.push(stored);
      out.push(stored);
    });
    await this.save();
    return out;
  }

  async items(filter: { since?: number; status?: StoredItem["status"] } = {}): Promise<StoredItem[]> {
    const state = await this.load();
    return state.items.filter(
      (i) => (filter.since === undefined || i.createdAt >= filter.since) && (!filter.status || i.status === filter.status),
    );
  }

  async get(id: string): Promise<StoredItem | undefined> {
    return (await this.load()).items.find((i) => i.id === id);
  }

  async update(id: string, patch: Partial<Pick<StoredItem, "status" | "url" | "kind">>): Promise<StoredItem> {
    const item = await this.get(id);
    if (!item) throw new Error(`No item with id ${id}`);
    Object.assign(item, patch);
    await this.save();
    return item;
  }
}

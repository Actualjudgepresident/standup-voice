export type Utterance = {
  speaker: string;
  text: string;
  spokenAt: number | null;
};

export type Conversation = {
  id: number;
  startTime: number;
  endTime: number | null;
  summary: string | null;
  utterances: Utterance[];
};

// task: something the wearer committed to doing ("I'll fix the retry logic").
// bug: a defect someone described. done: work reported finished.
// blocker: something stopping progress. decision: an agreed technical choice.
export const WORK_ITEM_KINDS = ["task", "bug", "done", "blocker", "decision"] as const;
export type WorkItemKind = (typeof WORK_ITEM_KINDS)[number];

export type WorkItem = {
  kind: WorkItemKind;
  title: string;
  detail: string;
  // Repo or component the item mentions, if any ("billing-service").
  area: string | null;
  // The wearer owns it (vs. a teammate saying it). Only owned tasks/bugs
  // become issues and Bee todos.
  ownedByWearer: boolean;
  conversationId: number;
  // Short paraphrase of what was said; transcripts are ASR so we avoid quoting.
  evidence: string;
  confidence: number;
};

// Where a work item came from: spoken notes (via the LLM), GitHub activity,
// or a Bee wearable conversation.
export type ItemSource = "note" | "github" | "bee";

export type StoredItem = WorkItem & {
  id: string;
  source: ItemSource;
  status: "open" | "completed";
  createdAt: number;
  url: string | null;
};

export type Extractor = {
  name: string;
  extract: (conversations: Conversation[]) => Promise<WorkItem[]>;
};

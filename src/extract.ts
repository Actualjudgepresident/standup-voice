import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { WORK_ITEM_KINDS } from "./types.ts";
import type { Conversation, Extractor, WorkItem, WorkItemKind } from "./types.ts";

const WorkItemsSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(WORK_ITEM_KINDS),
      title: z.string().describe("Imperative, issue-title style, under 80 chars"),
      detail: z.string().describe("1-3 sentences of context an engineer needs to act"),
      area: z.string().nullable().describe("Repo, service or component named, else null"),
      owned_by_wearer: z.boolean(),
      conversation_id: z.number().int(),
      evidence: z.string().describe("Paraphrase of what was said; do not quote verbatim"),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

const SYSTEM = `You turn a software engineer's ambient conversation transcripts (captured by a Bee wearable) into engineering work items.

The wearer is the speaker labelled "me" or "user"; if neither label exists, infer the wearer as the person whose day this is.

Extract only engineering-relevant items:
- task: something someone committed to doing ("I'll add retries", "let me look into the flaky test")
- bug: a defect described, with its symptom
- done: work reported as finished
- blocker: something stopping progress, waiting on a person or system
- decision: an agreed technical choice worth recording

Rules:
- Ignore small talk, personal plans, and non-engineering chores.
- Merge duplicates: the same task mentioned twice is one item.
- owned_by_wearer is true only when the wearer took it on or it is clearly theirs.
- Transcripts are ASR output and may mishear names and identifiers; say so in detail when an identifier looks garbled, and lower confidence.
- Paraphrase in evidence; never invent tickets, repos or people that were not mentioned.`;

function renderTranscripts(conversations: Conversation[]): string {
  return conversations
    .map((c) => {
      const lines = c.utterances.map((u) => `${u.speaker}: ${u.text}`).join("\n");
      const when = new Date(c.startTime).toISOString();
      return `<conversation id="${c.id}" started="${when}">\n${c.summary ? `Bee summary: ${c.summary}\n` : ""}${lines}\n</conversation>`;
    })
    .join("\n\n");
}

type MessagesClient = Pick<Anthropic, "messages">;

function llmExtractor(name: string, client: MessagesClient, model: string): Extractor {
  return {
    name,
    async extract(conversations) {
      if (conversations.length === 0) return [];
      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: "medium", format: zodOutputFormat(WorkItemsSchema) },
        messages: [{ role: "user", content: renderTranscripts(conversations) }],
      });
      if (response.stop_reason === "refusal") {
        throw new Error(`Model declined the request (${response.stop_details?.category ?? "no category"})`);
      }
      if (!response.parsed_output) {
        throw new Error(`Could not parse model output (stop_reason: ${response.stop_reason})`);
      }
      const known = new Set(conversations.map((c) => c.id));
      return response.parsed_output.items
        .filter((i) => known.has(i.conversation_id))
        .map((i) => ({
          kind: i.kind,
          title: i.title,
          detail: i.detail,
          area: i.area,
          ownedByWearer: i.owned_by_wearer,
          conversationId: i.conversation_id,
          evidence: i.evidence,
          confidence: i.confidence,
        }));
    },
  };
}

export function anthropicExtractor(model = process.env.STANDUPBEE_MODEL ?? "claude-opus-5-5"): Extractor {
  return llmExtractor(`anthropic:${model}`, new Anthropic(), model);
}

export function bedrockExtractor(
  model = process.env.STANDUPBEE_BEDROCK_MODEL ?? "anthropic.claude-opus-5-5",
): Extractor {
  const client = new AnthropicBedrockMantle({ awsRegion: process.env.AWS_REGION ?? "us-east-1" });
  return llmExtractor(`bedrock:${model}`, client, model);
}

// Offline keyword extractor: no API key, deterministic. Good enough for demos
// and tests; the LLM extractors are the real product.
const PATTERNS: Array<{ kind: WorkItemKind; re: RegExp }> = [
  { kind: "blocker", re: /\b(blocked on|waiting on|can't \w+(?: \w+){0,6} until)\b/i },
  { kind: "done", re: /\bi (?:finished|shipped|merged|deployed|fixed)\b/i },
  { kind: "decision", re: /\b(let's go with|we(?:'ll| will)? (?:go with|use|stick with)|decided to)\b/i },
  { kind: "bug", re: /\b(bug|broken|crash(?:es|ing)?|flaky|regression|throws|500s?)\b/i },
  { kind: "task", re: /\b(i'll|i will|let me|i need to|i'm going to|todo)\b/i },
];

const WEARER = new Set(["me", "user"]);
// Keeps "I'll get groceries" out of the issue tracker.
const ENGINEERING = /\b(fix|test|deploy|api|ticket|runbook|bug|merge|pr|service|worker|refactor|migration|retry|backoff|code|ci|log|ui|database|endpoint|webhook|lock|crash|release|oauth|auth|secret|key|credential|access|build|server|review|repo|branch)s?\b/i;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

function toTitle(text: string): string {
  const cleaned = text
    .replace(/^((?:ok(?:ay)?|so|yeah|and|right|cool|um+|uh+)[,\s]+)+/i, "")
    .replace(/\b(i'll|i will|let me|i need to|i'm going to)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const t = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}

export function rulesExtractor(): Extractor {
  return {
    name: "rules",
    async extract(conversations) {
      const items: WorkItem[] = [];
      const seen = new Set<string>();
      for (const c of conversations) {
        for (const u of c.utterances) for (const sentence of sentences(u.text)) {
          if (!ENGINEERING.test(sentence)) continue;
          const match = PATTERNS.find((p) => p.re.test(sentence));
          if (!match) continue;
          const title = toTitle(sentence);
          const key = `${match.kind}:${title.toLowerCase()}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({
            kind: match.kind,
            title,
            detail: `Mentioned by ${u.speaker} during conversation ${c.id}.`,
            area: null,
            ownedByWearer: WEARER.has(u.speaker.toLowerCase()),
            conversationId: c.id,
            evidence: sentence,
            confidence: 0.4,
          });
        }
      }
      return items;
    },
  };
}

export function pickExtractor(name: string): Extractor {
  switch (name) {
    case "anthropic":
      return anthropicExtractor();
    case "bedrock":
      return bedrockExtractor();
    case "rules":
      return rulesExtractor();
    default:
      throw new Error(`Unknown extractor "${name}" (use anthropic, bedrock or rules)`);
  }
}

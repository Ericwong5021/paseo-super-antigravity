import { readFile } from "node:fs/promises";
import type { ProviderTimelineItem } from "@getpaseo/plugin/server/provider";
import { pluginDataDir, unsafePathChars } from "../core/plugindata";

/**
 * Task handoff: turn one session's stored timeline into a brief another agent can start from.
 *
 * The timeline is the same file the fork replays on `history: "replay"`, so a handoff never needs
 * the session to be open and never asks a model to summarize itself. Rows are keyed by id and
 * republished as they stream, so the newest snapshot of each id wins and the first appearance
 * gives the order.
 */
export interface BriefResult {
  brief: string;
  rows: number;
  truncated: boolean;
}

type Row = ProviderTimelineItem;

export async function buildBrief(sessionId: string, maxChars: number): Promise<BriefResult> {
  const rows = await readRows(sessionId);
  if (rows.length === 0) {
    return { brief: emptyBrief(sessionId), rows: 0, truncated: false };
  }

  const blocks = rows.flatMap(render);
  const kept: string[] = [];
  let used = 0;
  let truncated = false;

  // Keep the newest rows: the tail is what a successor needs (where the work stopped), and the
  // original request is preserved separately below when the budget allows.
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (used + block.length > maxChars) {
      truncated = true;
      break;
    }
    kept.push(block);
    used += block.length;
  }
  kept.reverse();

  const first = rows.find((row) => row.type === "user_message");
  const header = [
    "# Handoff",
    "",
    `Session: \`${sessionId}\``,
    first !== undefined && first.type === "user_message"
      ? `\n## Original request\n\n${clip(first.text, 2_000)}\n`
      : "",
    truncated ? "> Earlier rows were dropped to fit the budget.\n" : "",
    "## Timeline\n",
  ]
    .filter((part) => part.length > 0)
    .join("\n");

  return { brief: `${header}\n${kept.join("\n")}`.trimEnd(), rows: rows.length, truncated };
}

async function readRows(sessionId: string): Promise<Row[]> {
  let raw: string;
  try {
    raw = await readFile(transcriptFile(sessionId), "utf8");
  } catch {
    return [];
  }

  const order: string[] = [];
  const latest = new Map<string, Row>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const item = JSON.parse(trimmed) as Row;
      if (item === null || typeof item !== "object" || typeof item.id !== "string") continue;
      if (!latest.has(item.id)) order.push(item.id);
      latest.set(item.id, item);
    } catch {
      // A line written mid-flush is skipped; the row is republished with the next update.
    }
  }
  return order.map((id) => latest.get(id)).filter((row): row is Row => row !== undefined);
}

function render(row: Row): string[] {
  switch (row.type) {
    case "user_message":
      return [`### User\n\n${clip(row.text, 4_000)}`];
    case "assistant_message":
      return [`### Assistant\n\n${clip(row.text, 4_000)}`];
    case "reasoning":
      return [];
    case "tool_call": {
      const summary = summarizeTool(row.name, row.detail);
      const status = row.status === "failed" ? " (failed)" : row.status === "running" ? " (running)" : "";
      return [`- ${summary}${status}`];
    }
    case "todo":
      return [
        "### Plan",
        "",
        ...row.items.map((item) => `- [${item.completed ? "x" : " "}] ${item.text}`),
      ];
    case "error":
      return [`> error: ${clip(row.message, 600)}`];
    case "compaction":
      return [`> context compacted (${row.status})`];
    case "notification":
      return [];
    case "plugin":
      return [];
    default:
      return [];
  }
}

type DetailOf = Extract<ProviderTimelineItem, { type: "tool_call" }>["detail"];

function summarizeTool(name: string, detail: DetailOf): string {
  switch (detail.type) {
    case "shell":
      return `ran \`${clip(detail.command, 240)}\``;
    case "read":
      return `read ${detail.filePath}`;
    case "edit":
    case "write":
      return `edited ${detail.filePath}`;
    case "search":
      return `searched ${clip(detail.query, 120)}`;
    case "fetch":
      return `fetched ${detail.url}`;
    case "sub_agent":
      return `delegated to subagent ${detail.subAgentType ?? ""}`.trim();
    case "plan":
      return "produced a plan";
    case "plain_text":
      return detail.text === undefined ? name : clip(detail.text, 160);
    default:
      return `${name} (${detail.type})`;
  }
}

function emptyBrief(sessionId: string): string {
  return [
    "# Handoff",
    "",
    `Session: \`${sessionId}\``,
    "",
    "No stored transcript was found for this session, so the handoff carries no history.",
    "The successor should ask for the current state of the work before acting.",
  ].join("\n");
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** Exported for tests: the transcript filename an id maps to. */
export function transcriptFile(sessionId: string): string {
  return pluginDataDir("transcripts", `${sessionId.replace(unsafePathChars, "_")}.jsonl`);
}

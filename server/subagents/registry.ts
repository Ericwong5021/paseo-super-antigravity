import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pluginDataDir } from "../core/plugindata";

/**
 * An index of the child sessions the fork announced.
 *
 * Paseo already opens each agy subagent as a child session (`session.opened` with a parent and a
 * tool-call id), which is what makes them show up as subagent rows and a subagent track. What that
 * stream does not give a *screen* is history: after a reload, or for a parent that is closed, there
 * is no way to ask "which subagents did this session run?".
 *
 * This is that memory, and nothing more. It is written from the provider's own emit path, so it can
 * never disagree with what opened, and it is capped so a long-running plugin cannot grow without
 * bound. Child sessions stay read-only: agy owns them, and this fork does not pretend otherwise.
 */
export interface ChildRecord {
  id: string;
  parentId: string | null;
  /** agy's own role for the child, e.g. "research" — free text from the model. */
  role: string | null;
  /** The instruction the parent gave, clipped. */
  prompt: string | null;
  cwd: string | null;
  openedAt: number;
}

const MAX_RECORDS = 200;
const PROMPT_LIMIT = 400;

let cache: ChildRecord[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

/** Records a child session. Fire-and-forget by design: the emit path must never await disk. */
export function recordChild(input: {
  id: string;
  parentId: string | null;
  role: string | null;
  prompt: string | null;
  cwd: string | null;
}): void {
  const record: ChildRecord = {
    id: input.id,
    parentId: input.parentId,
    role: input.role,
    prompt: input.prompt === null ? null : input.prompt.slice(0, PROMPT_LIMIT),
    cwd: input.cwd,
    openedAt: Date.now(),
  };

  const next = [record, ...(cache ?? []).filter((entry) => entry.id !== record.id)].slice(
    0,
    MAX_RECORDS,
  );
  cache = next;
  writeChain = writeChain
    .then(() => writeRecords(next))
    .catch((error: unknown) => {
      console.error(`[antigravity-super] could not record subagent: ${describe(error)}`);
    });
}

export async function listChildren(limit: number): Promise<ChildRecord[]> {
  const records = cache ?? (await readRecords());
  cache = records;
  return records.slice(0, limit);
}

async function readRecords(): Promise<ChildRecord[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path(), "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): ChildRecord[] => {
      if (value === null || typeof value !== "object") return [];
      const record = value as Record<string, unknown>;
      if (typeof record["id"] !== "string") return [];
      return [
        {
          id: record["id"],
          parentId: typeof record["parentId"] === "string" ? record["parentId"] : null,
          role: typeof record["role"] === "string" ? record["role"] : null,
          prompt: typeof record["prompt"] === "string" ? record["prompt"] : null,
          cwd: typeof record["cwd"] === "string" ? record["cwd"] : null,
          openedAt: typeof record["openedAt"] === "number" ? record["openedAt"] : 0,
        },
      ];
    });
  } catch {
    return [];
  }
}

async function writeRecords(records: readonly ChildRecord[]): Promise<void> {
  const file = path();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(records, null, 2)}\n`);
}

function path(): string {
  return pluginDataDir("subagents.json");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

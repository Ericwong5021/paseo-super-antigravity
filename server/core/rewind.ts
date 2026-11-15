import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import type { ProviderTimelineItem } from "@getpaseo/plugin/server/provider";
import { accountGeminiRoot } from "./accounts";
import { conversationTranscriptPath } from "./backfill";
import { pluginDataDir } from "./plugindata";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
interface Checkpoint {
  version: 1;
  accountId: string;
  conversationId: string | null;
  items: ProviderTimelineItem[];
  hasLog: boolean;
}

function databasePath(accountId: string, conversationId: string): string {
  if (!UUID.test(conversationId)) throw new Error("Invalid Antigravity conversation id");
  return join(
    accountGeminiRoot(accountId),
    "antigravity-cli",
    "conversations",
    `${conversationId}.db`,
  );
}

async function snapshotDatabase(source: string, destination: string): Promise<void> {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
  } finally {
    db.close();
  }
}

/** Capture before submitting a user turn, while the native session is idle. */
export async function createRewindCheckpoint(input: {
  accountId: string;
  conversationId: string | null;
  items: readonly ProviderTimelineItem[];
}): Promise<{ checkpoint: string }> {
  const checkpoint = randomUUID();
  const dir = pluginDataDir("rewind", checkpoint);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    let hasLog = false;
    if (input.conversationId !== null) {
      await snapshotDatabase(
        databasePath(input.accountId, input.conversationId),
        join(dir, "before.db"),
      );
      const log = conversationTranscriptPath(
        accountGeminiRoot(input.accountId),
        input.conversationId,
      );
      if (existsSync(log)) {
        await copyFile(log, join(dir, "before.jsonl"));
        hasLog = true;
      }
    }
    const metadata: Checkpoint = {
      ...input,
      items: [...input.items],
      version: 1,
      hasLog,
    };
    await writeFile(join(dir, "checkpoint.json"), JSON.stringify(metadata), {
      mode: 0o600,
    });
    return { checkpoint };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Call only after stopping the native runtime. Never modify the checkpoint itself. */
export async function restoreRewindCheckpoint(input: {
  token: unknown;
  accountId: string;
  conversationId: string | null;
  items: readonly ProviderTimelineItem[];
}): Promise<Checkpoint> {
  const token = input.token as { checkpoint?: unknown } | null;
  if (!token || typeof token.checkpoint !== "string" || !UUID.test(token.checkpoint)) {
    throw new Error(
      "This message has no Antigravity rewind checkpoint; only newly recorded turns can be withdrawn",
    );
  }
  if (
    !input.items.some(
      (item) =>
        item.type === "user_message" &&
        (item.revertToken as { checkpoint?: unknown } | undefined)?.checkpoint === token.checkpoint,
    )
  ) {
    throw new Error("The rewind target is no longer in this conversation");
  }
  const dir = pluginDataDir("rewind", token.checkpoint);
  const metadata: Checkpoint = JSON.parse(await readFile(join(dir, "checkpoint.json"), "utf8"));
  if (
    metadata.version !== 1 ||
    metadata.accountId !== input.accountId ||
    (metadata.conversationId !== null && metadata.conversationId !== input.conversationId)
  ) {
    throw new Error("The checkpoint belongs to another Antigravity conversation or account");
  }
  if (metadata.conversationId !== null) {
    const target = databasePath(input.accountId, metadata.conversationId);
    // Preserve the state being withdrawn, including WAL contents, for manual recovery.
    const archive = join(dir, `withdrawn-${randomUUID()}`);
    await snapshotDatabase(target, `${archive}.db`);
    const log = conversationTranscriptPath(
      accountGeminiRoot(input.accountId),
      metadata.conversationId,
    );
    if (existsSync(log)) await copyFile(log, `${archive}.jsonl`);
    await writeFile(`${archive}.timeline.json`, JSON.stringify(input.items), {
      mode: 0o600,
    });
    const staged = `${target}.${randomUUID()}.tmp`;
    await copyFile(join(dir, "before.db"), staged);
    // No native writer may remain when restoring. SQLite sidecars describe the old database.
    await rm(`${target}-wal`, { force: true });
    await rm(`${target}-shm`, { force: true });
    await rename(staged, target);
    if (metadata.hasLog) {
      await mkdir(join(log, ".."), { recursive: true });
      await copyFile(join(dir, "before.jsonl"), log);
    } else {
      await rm(log, { force: true });
    }
  }
  return metadata;
}

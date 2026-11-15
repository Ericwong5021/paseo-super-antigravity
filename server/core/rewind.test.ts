import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import type { ProviderTimelineItem } from "@getpaseo/plugin/server/provider";

vi.mock("./accounts", () => ({
  accountGeminiRoot: () => join(process.env.PASEO_HOME!, ".gemini"),
}));
import { createRewindCheckpoint, restoreRewindCheckpoint } from "./rewind";
import { TranscriptStore } from "./transcript";

let taskRoot: string | undefined;
afterEach(async () => {
  if (taskRoot) await rm(taskRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

test("restores a complete native checkpoint including WAL and retains the withdrawn state", async () => {
  taskRoot = await mkdtemp(join(tmpdir(), "agy-rewind-"));
  vi.stubEnv("PASEO_HOME", taskRoot);
  const conversationId = "96a9e574-d43e-42a5-9820-8e4f1806c761";
  const dbDir = join(taskRoot, ".gemini/antigravity-cli/conversations");
  await mkdir(dbDir, { recursive: true });
  const path = join(dbDir, `${conversationId}.db`);
  let db = new DatabaseSync(path);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE steps(idx INTEGER, text TEXT); INSERT INTO steps VALUES(0, 'retained context')",
  );
  const log = join(
    taskRoot,
    ".gemini/antigravity-cli/brain",
    conversationId,
    ".system_generated/logs/transcript.jsonl",
  );
  await mkdir(join(log, ".."), { recursive: true });
  await writeFile(log, "retained\n");
  const before: ProviderTimelineItem[] = [{ type: "user_message", id: "first", text: "retained" }];
  const token = await createRewindCheckpoint({
    accountId: "default",
    conversationId,
    items: before,
  });
  db.exec("INSERT INTO steps VALUES(1, 'withdrawn secret')");
  db.close();
  await writeFile(log, "retained\nwithdrawn\n");
  const items: ProviderTimelineItem[] = [
    ...before,
    {
      type: "user_message",
      id: "second",
      text: "withdrawn",
      revertToken: token,
    },
  ];
  await expect(
    restoreRewindCheckpoint({
      token,
      accountId: "other",
      conversationId,
      items,
    }),
  ).rejects.toThrow("another");
  await expect(
    restoreRewindCheckpoint({
      token,
      accountId: "default",
      conversationId,
      items: before,
    }),
  ).rejects.toThrow("no longer");
  const restored = await restoreRewindCheckpoint({
    token,
    accountId: "default",
    conversationId,
    items,
  });
  expect(restored.items).toEqual(before);
  db = new DatabaseSync(path, { readOnly: true });
  expect(
    db
      .prepare("SELECT text FROM steps ORDER BY idx")
      .all()
      .map((row) => row.text),
  ).toEqual(["retained context"]);
  db.close();
  expect(await readFile(log, "utf8")).toBe("retained\n");
  const files = await readdir(
    join(taskRoot, "plugin-data/antigravity-super/rewind", token.checkpoint),
  );
  expect(
    files.filter((name) => name.startsWith("withdrawn-") && name.endsWith(".db")),
  ).toHaveLength(1);
  const store = new TranscriptStore(conversationId);
  items.forEach((item) => store.upsert(item));
  store.replace(restored.items);
  await store.flush();
  expect((await TranscriptStore.load(conversationId)).list()).toEqual(before);
});

test("withdraws the first turn without modifying its original conversation", async () => {
  taskRoot = await mkdtemp(join(tmpdir(), "agy-rewind-first-"));
  vi.stubEnv("PASEO_HOME", taskRoot);
  const token = await createRewindCheckpoint({
    accountId: "default",
    conversationId: null,
    items: [],
  });
  const restored = await restoreRewindCheckpoint({
    token,
    accountId: "default",
    conversationId: "96a9e574-d43e-42a5-9820-8e4f1806c761",
    items: [{ type: "user_message", id: "first", text: "new", revertToken: token }],
  });
  expect(restored.conversationId).toBeNull();
  expect(restored.items).toEqual([]);
  await expect(
    restoreRewindCheckpoint({
      token: { checkpoint: "../../outside" },
      accountId: "default",
      conversationId: null,
      items: [],
    }),
  ).rejects.toThrow("no Antigravity rewind checkpoint");
});

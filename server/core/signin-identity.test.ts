import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forgetRealAgyIdentity, readRealAgyIdentity } from "./signin-identity";

const roots: string[] = [];

function makeHome(): { home: string; logDir: string } {
  const home = mkdtempSync(join(tmpdir(), "agy-identity-"));
  roots.push(home);
  const logDir = join(home, ".gemini", "antigravity-cli", "log");
  mkdirSync(logDir, { recursive: true });
  return { home, logDir };
}

function writeLog(
  logDir: string,
  name: string,
  email: string | null,
  secondsAgo: number,
): void {
  const body =
    email === null
      ? "I1115 15:51:23.000000 1 server.go:1] starting\n"
      : `W1115 15:51:23.000000 1 cache.go:157] Cache(userInfo): refresh failed\nI1115 15:51:23.492848 1 server_oauth.go:221] applyAuthResult: email=${email}, authMethod=consumer\n`;
  const path = join(logDir, name);
  writeFileSync(path, body, "utf8");
  const at = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(path, at, at);
}

afterEach(() => {
  forgetRealAgyIdentity();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readRealAgyIdentity", () => {
  it("answers with the newest process that reported a sign-in", () => {
    const { home, logDir } = makeHome();
    writeLog(logDir, "cli-old.log", "lolipo.555a@gmail.com", 600);
    writeLog(logDir, "acp-server-new.log", "ericwong5021@gmail.com", 5);
    expect(readRealAgyIdentity({ refresh: true, geminiHome: home })).toMatchObject({
      email: "ericwong5021@gmail.com",
    });
  });

  it("skips logs that never reached a sign-in", () => {
    const { home, logDir } = makeHome();
    writeLog(logDir, "cli-old.log", "jenifferchristhopher694@gmail.com", 300);
    writeLog(logDir, "cli-booting.log", null, 1);
    expect(readRealAgyIdentity({ refresh: true, geminiHome: home })?.email).toBe(
      "jenifferchristhopher694@gmail.com",
    );
  });

  it("answers nothing when no CLI has run", () => {
    const { home } = makeHome();
    expect(readRealAgyIdentity({ refresh: true, geminiHome: home })).toBeNull();
  });

  it("caches until a probe asks for a fresh answer", () => {
    const { home, logDir } = makeHome();
    writeLog(logDir, "cli-1.log", "ericwong5021@gmail.com", 30);
    expect(readRealAgyIdentity({ geminiHome: home })?.email).toBe(
      "ericwong5021@gmail.com",
    );
    writeLog(logDir, "cli-2.log", "jenifferchristhopher694@gmail.com", 1);
    expect(readRealAgyIdentity({ geminiHome: home })?.email).toBe(
      "ericwong5021@gmail.com",
    );
    expect(readRealAgyIdentity({ refresh: true, geminiHome: home })?.email).toBe(
      "jenifferchristhopher694@gmail.com",
    );
  });
});

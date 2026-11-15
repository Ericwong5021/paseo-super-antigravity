import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Which account the local `agy` is signed in as, read from the CLI's own log.
 *
 * `agy` resolves its config root as `$HOME/.gemini` and writes one glog file per process under
 * `.gemini/antigravity-cli/log/`. At startup each process records the sign-in it applied:
 *
 *   I1115 15:51:23.492848  1 server_oauth.go:221] applyAuthResult: email=someone@gmail.com, authMethod=consumer
 *
 * That line is the only cheap statement of identity the CLI makes: `/usage` reports quota without
 * an email, the ACP handshake carries none, and `~/.gemini/oauth_creds.json` is *not* authoritative
 * — `agy` reads the token from the macOS Keychain, which can hold a different account. So the newest
 * process that logged an identity wins, and a probe (`agy -p /usage`, which spends no quota) is how
 * the caller forces a fresher answer after switching accounts.
 */
export interface RealAgyIdentity {
  email: string;
  /** The log that carried the answer; the newest agy process is the authority. */
  logFile: string;
  /** When that log was last written. */
  at: number;
}

interface ReadIdentityOptions {
  /** Ignore the short cache after a probe asked the CLI to report again. */
  refresh?: boolean;
  /** Test seam: the `.gemini` root. Defaults to the real home. */
  geminiHome?: string;
}

const IDENTITY_PATTERN = /applyAuthResult: email=([^\s,]+)/;
/** The line lands before the first turn, so only the head of each log has to be read. */
const LOG_HEAD_BYTES = 64 * 1024;
/** Enough to cover a switch followed by a probe without walking the whole history. */
const MAX_LOGS_SCANNED = 6;
const CACHE_MS = 15_000;

let cache: { at: number; value: RealAgyIdentity | null } | null = null;

export function readRealAgyIdentity(
  options: ReadIdentityOptions = {},
): RealAgyIdentity | null {
  if (options.refresh !== true && cache !== null && Date.now() - cache.at < CACHE_MS) {
    return cache.value;
  }
  const value = scan(options.geminiHome);
  cache = { at: Date.now(), value };
  return value;
}

/** Drops the cached answer, so a caller that knows the sign-in just changed reads it again. */
export function forgetRealAgyIdentity(): void {
  cache = null;
}

function scan(geminiHome: string | undefined): RealAgyIdentity | null {
  const logDir = join(geminiHome ?? homedir(), ".gemini", "antigravity-cli", "log");
  let names: string[];
  try {
    names = readdirSync(logDir).filter((name) => name.endsWith(".log"));
  } catch {
    return null;
  }
  const logs: { path: string; at: number }[] = [];
  for (const name of names) {
    const path = join(logDir, name);
    try {
      const info = statSync(path);
      if (info.isFile()) logs.push({ path, at: info.mtimeMs });
    } catch {
      // A log removed mid-scan carries no answer.
    }
  }
  logs.sort((left, right) => right.at - left.at);
  for (const log of logs.slice(0, MAX_LOGS_SCANNED)) {
    const match = readHead(log.path).match(IDENTITY_PATTERN);
    if (match) return { email: match[1], logFile: log.path, at: log.at };
  }
  return null;
}

function readHead(path: string): string {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(LOG_HEAD_BYTES);
    const read = readSync(fd, buffer, 0, LOG_HEAD_BYTES, 0);
    return buffer.toString("utf8", 0, read);
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

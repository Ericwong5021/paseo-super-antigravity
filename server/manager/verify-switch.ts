import { DEFAULT_ACCOUNT_ID } from "../core/accounts";
import { readAccountQuota } from "../core/quota";
import { readRealAgyIdentity } from "../core/signin-identity";
import { readManagerState } from "./store";

/**
 * Confirms that a Tools account switch reached the account `agy` actually signs in as.
 *
 * The Tools pointer is not proof. `agy` reads its token from the macOS Keychain while the switch
 * updates the pointer (and `~/.gemini/oauth_creds.json`), and those two have drifted apart here:
 * `current_agy_account_id` named an idle account while every launch kept signing in as a different
 * one (probed 2026-11-15). Reading `/usage` through the real home spawns one CLI process that logs
 * the sign-in it applied and spends no quota, so that is the cheapest honest answer; a switch that
 * produced no new log stays unverified rather than being reported as a failure.
 */
export interface ManagerAgySwitchVerification {
  expectedEmail: string | null;
  actualEmail: string | null;
  /** Set only when a fresh CLI process proved the switch did not take. */
  message: string | null;
}

function normalizeEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

export async function verifyManagerAgySwitch(input: {
  accountId: string;
  home?: string;
  port?: number;
}): Promise<ManagerAgySwitchVerification> {
  const state = await readManagerState({ home: input.home, port: input.port });
  const expectedEmail =
    state.accounts.find((account) => account.id === input.accountId)?.email ?? null;

  const probeStartedAt = Date.now();
  // Also refreshes the real home's cached quota, so the panel shows the new account's figures.
  await readAccountQuota(DEFAULT_ACCOUNT_ID, { refresh: true });
  const identity = readRealAgyIdentity({ refresh: true });
  const actualEmail = identity?.email ?? null;
  if (identity === null || identity.at < probeStartedAt) {
    return { expectedEmail, actualEmail, message: null };
  }

  const expected = normalizeEmail(expectedEmail);
  const actual = normalizeEmail(actualEmail);
  if (expected.length === 0 || actual.length === 0 || expected === actual) {
    return { expectedEmail, actualEmail, message: null };
  }
  return {
    expectedEmail,
    actualEmail,
    message: `切换未生效：agy 仍以 ${actualEmail} 登录（目标 ${expectedEmail}）。请在本机 CLI 重新登录，或再点一次「使用」。`,
  };
}

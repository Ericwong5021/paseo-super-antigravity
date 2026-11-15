/**
 * Which account the local `agy` is really signed in as, and whether Antigravity Tools agrees.
 *
 * `agy` keeps its sign-in in the macOS login Keychain, and Antigravity Tools keeps its own
 * `current_agy_account_id` pointer in `~/.antigravity_tools/accounts.json`. The two drift: the
 * Tools switch can update its pointer (and `~/.gemini/oauth_creds.json`) without touching the
 * Keychain `agy` reads, so the panel would otherwise mark an idle account as current while a
 * different one is burning quota.
 */

/** The real home's account id, as `server/core/accounts.ts` defines it. */
export const REAL_HOME_ACCOUNT_ID = "default";

export interface LiveAgyOwnerInput {
  /** Email `agy` last reported, or null when no launch has been observed yet. */
  realEmail: string | null;
  /** The plugin's own account selection: `default` or a shadow account id. */
  agyActive: string;
  managerAccounts: readonly { id: string; email: string | null; isCurrent: boolean }[];
}

export interface LiveAgyOwner {
  /** Manager account `agy` is signed in as. Null when the pool cannot name it. */
  ownerId: string | null;
  /** The Tools pointer names a different account than `agy` is signed in as. */
  pointerMismatch: boolean;
}

function normalizeEmail(email: string | null | undefined): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * A shadow account is the answer by itself: the plugin launched `agy` with that account's home.
 * On the real home the answer comes from the CLI's own sign-in report, and only falls back to the
 * Tools pointer while no launch has been observed.
 */
export function resolveLiveAgyOwner(input: LiveAgyOwnerInput): LiveAgyOwner {
  if (input.agyActive !== REAL_HOME_ACCOUNT_ID) {
    return { ownerId: null, pointerMismatch: false };
  }
  const pointer = input.managerAccounts.find((account) => account.isCurrent) ?? null;
  const realEmail = normalizeEmail(input.realEmail);
  if (realEmail.length === 0) {
    return { ownerId: pointer?.id ?? null, pointerMismatch: false };
  }
  const match =
    input.managerAccounts.find(
      (account) => normalizeEmail(account.email) === realEmail,
    ) ?? null;
  const pointerEmail = normalizeEmail(pointer?.email);
  return {
    ownerId: match?.id ?? null,
    pointerMismatch: pointerEmail.length > 0 && pointerEmail !== realEmail,
  };
}

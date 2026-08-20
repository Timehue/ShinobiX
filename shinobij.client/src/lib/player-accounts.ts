// Local per-account cache (localStorage). Drained verbatim out of App.tsx.
//
// This is ONLY a legacy name list plus an optional paint-fast snapshot — the
// server KV is the source of truth for saves and auth. Load-bearing security
// detail, preserved exactly as it was in App.tsx: a reusable password is never
// persisted here. loadPlayerAccounts actively scrubs a `password` key if an old
// build left one behind, and savePlayerAccounts strips `password` on write, so
// the token-first auth model holds even for users upgrading from a build that
// did persist one. Do not "simplify" either of those away.
import type { Character } from "../types/character";
import type { Biome } from "../types/core";
import type { ActiveTraining, ActiveJutsuTraining } from "../types/combat";
import { PLAYER_ACCOUNTS_STORAGE } from "../constants/game";
import { isTokenExpired } from "../authFetch";

export type PendingTravelSave = { destinationSector: number; arrivalAt: number };

export type PlayerAccountSave = {
    // Per-account session token (24h). Reusable passwords are never persisted.
    token?: string;
    snapshot?: {
        character: Character;
        currentBiome: Biome;
        activeTraining: ActiveTraining | null;
        activeJutsuTraining?: ActiveJutsuTraining | null;
        acceptedMissionIds: string[];
        missionProgress: Record<string, number>;
        triggeredEvents: string[];
        /** @deprecated Read-only rolling-upgrade residue; never restored or saved. */
        pendingAiProfileId?: string;
        currentSector?: number;
        pendingTravel?: PendingTravelSave | null;
    };
};

export type PlayerAccounts = Record<string, PlayerAccountSave>;

export function accountKey(name: string) {
    return name.trim().toLowerCase();
}

/**
 * The shinobi this browser can return to in one press: accounts it still holds
 * a session token for, plus a guest character if one lives here.
 *
 * Shared so the gate and the copy beside it agree. Greeting a first-time
 * visitor with "your story is still moving" is a small lie, and the only way to
 * avoid it is for both halves of the screen to read the same list.
 */
export function rememberedShinobi(): { name: string; guest: boolean }[] {
    const accounts = loadPlayerAccounts();
    let guestName = "";
    try { guestName = (localStorage.getItem("shinobix:guestName") ?? "").toLowerCase(); } catch { /* private mode */ }

    // A token whose own expiry has passed is not a way back in: pressing its
    // chip would re-install a dead credential, every call would 401, and the
    // player would be told their save could not be found. Drop those here so
    // the gate only ever offers a press that can actually work. A guest whose
    // token lapsed is still offered below — their resume credential outlives it.
    const named = Object.entries(accounts)
        .filter(([, account]) => Boolean(account?.token) && !isTokenExpired(account.token!))
        .map(([key]) => key);
    const all = guestName && !named.includes(guestName) ? [...named, guestName] : named;
    return all.slice(0, 4).map((name) => ({ name, guest: name === guestName }));
}

/**
 * Store (`token`) or drop (`null`) one account's session token, leaving the rest
 * of its blob alone. Dropping is what a proven-dead token needs: left in place,
 * it keeps the account's "Continue as" chip on the gate, and every press of it
 * re-installs a credential that can only 401.
 */
function writeAccountToken(name: string, token: string | null) {
    const key = accountKey(name);
    if (!key) return;
    const accounts = loadPlayerAccounts();
    if (token) accounts[key] = { ...(accounts[key] ?? {}), token };
    else if (accounts[key]?.token) delete accounts[key].token;
    else return;
    savePlayerAccounts(accounts);
}

/** Keep the per-account token blob in step after any successful sign-in. */
export const rememberAccountToken = (name: string, token: string) => writeAccountToken(name, token);

/** Forget a token the server has proved dead (a 401 on the save pull). */
export const forgetAccountToken = (name: string) => writeAccountToken(name, null);

export function loadPlayerAccounts(): PlayerAccounts {
    try {
        const raw = localStorage.getItem(PLAYER_ACCOUNTS_STORAGE);
        const accounts = (raw ? JSON.parse(raw) : {}) as Record<string, PlayerAccountSave & { password?: unknown }>;
        let scrubbed = false;
        for (const account of Object.values(accounts)) {
            if (account && Object.prototype.hasOwnProperty.call(account, 'password')) {
                delete account.password;
                scrubbed = true;
            }
        }
        if (scrubbed) localStorage.setItem(PLAYER_ACCOUNTS_STORAGE, JSON.stringify(accounts));
        return accounts;
    } catch {
        return {};
    }
}

export function savePlayerAccounts(accounts: PlayerAccounts) {
    // Local account cache is only a legacy name list. Server KV is the save/auth source of truth.
    function noImages(_key: string, value: unknown) {
        if (_key === "password") return undefined;
        if (_key === "snapshot") return undefined;
        if (typeof value === "string" && value.startsWith("data:image")) return "";
        return value;
    }
    try {
        localStorage.setItem(PLAYER_ACCOUNTS_STORAGE, JSON.stringify(accounts, noImages));
    } catch {
        // If it still fails for some reason, silently skip — server save is the source of truth
    }
}

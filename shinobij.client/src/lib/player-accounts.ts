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
        pendingAiProfileId: string;
        currentSector?: number;
        pendingTravel?: PendingTravelSave | null;
    };
};

export type PlayerAccounts = Record<string, PlayerAccountSave>;

export function accountKey(name: string) {
    return name.trim().toLowerCase();
}

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

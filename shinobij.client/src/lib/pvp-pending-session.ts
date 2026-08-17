import type { PvpSessionState } from "../types/pvp-ui";
export const PVP_BROWSER_RECOVERY_TTL_MS = 48 * 60 * 60 * 1000;

export type PvpRecoveryContext = {
    mode?: "standard" | "ranked" | "clanWar1v1" | "clanWar2v2" | "clanWarPet" | "rankedPet";
    clanWarPoints?: number;
    sectorAttack?: boolean;
    raidKind?: "raidPlayer" | "defense";
    sector?: number;
    clanWarChallengeId?: string;
    kageChallengeId?: string;
    kageVillage?: string;
};

export type PvpBrowserBreadcrumb = {
    owner: string;
    pvpBattleId: string;
    pvpRole?: "p1" | "p2";
    pvpBattleContext?: PvpRecoveryContext;
    savedAt: number;
};

export type PendingPvpRecovery = {
    battleId: string;
    role: "p1" | "p2";
    session: PvpSessionState;
    context: PvpRecoveryContext;
};

export type PvpCreateRecoveryDecision =
    | { kind: "pending"; pending: PendingPvpRecovery }
    | { kind: "stable-id"; battleId: string }
    | { kind: "clear" };

/** Keep ambiguous create publication discoverable in the current mount. */
export function decidePvpCreateRecovery(args: {
    pending: PendingPvpRecovery | null;
    createRejected: boolean;
    recoveryChecked: boolean;
    stableBattleId: string;
}): PvpCreateRecoveryDecision {
    if (args.pending) return { kind: "pending", pending: args.pending };
    const battleId = args.stableBattleId.trim();
    if ((!args.createRejected || !args.recoveryChecked) && battleId) {
        return { kind: "stable-id", battleId };
    }
    return { kind: "clear" };
}

export function readPvpBrowserBreadcrumb(
    storage: Pick<Storage, "getItem" | "removeItem"> | null,
    key: string,
    expectedOwner: string,
    now = Date.now(),
): PvpBrowserBreadcrumb | null {
    if (!storage) return null;
    let raw: string | null = null;
    try {
        raw = storage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PvpBrowserBreadcrumb>;
        const age = now - Number(parsed.savedAt ?? 0);
        if (parsed.owner !== expectedOwner
            || typeof parsed.pvpBattleId !== "string"
            || !parsed.pvpBattleId.trim()
            || !Number.isFinite(age)
            || age < 0
            || age >= PVP_BROWSER_RECOVERY_TTL_MS
            || (parsed.pvpRole !== undefined && parsed.pvpRole !== "p1" && parsed.pvpRole !== "p2")) {
            storage.removeItem(key);
            return null;
        }
        return {
            owner: parsed.owner,
            pvpBattleId: parsed.pvpBattleId.trim(),
            pvpRole: parsed.pvpRole,
            pvpBattleContext: parsed.pvpBattleContext,
            savedAt: Number(parsed.savedAt),
        };
    } catch {
        try { if (raw) storage.removeItem(key); } catch { /* storage denied */ }
        return null;
    }
}

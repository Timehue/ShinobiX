import type { WorldAiFightContext } from "../../../shared/world-ai-fight";
import type { Character } from "../types/character";

// Client-side presentation/chain-recovery handoff for World Map fights.
//
// AiFightHost repairs this presentation record from server-sealed context before
// showing the canonical solo-PvE fight. WorldMap consumes only the settlement
// event/report echoed by that seal to continue a chain or a turn-in callback.
//
// The outcome is stamped here rather than inferred on the map from a totalAiKills
// delta, because that kill count syncs asynchronously (and can be clobbered by a
// save-conflict refetch). Inferring from it made real ambush WINS resolve as losses.
export const WANDERER_PENDING_KEY = "wandererFight.pending.v1";

export type WandererFightSettlement = {
    outcome: "win" | "loss" | "draw" | "forfeit";
    worldContext: WorldAiFightContext;
    character?: Character | null;
    _saveVersion?: number;
};
export const WANDERER_FIGHT_SETTLED_EVENT = "shinobi:world-ai-fight-settled";

/** These wins still have an idempotent, server-verified progression callback
 * after combat settlement. Keep their presentation record until that callback
 * acknowledges success so a refresh or dropped response cannot strand the
 * player between "boss defeated" and the normal quest/turn-in state. */
export function worldFightNeedsDurableFollowUp(settlement: WandererFightSettlement): boolean {
    if (settlement.outcome !== "win") return false;
    const context = settlement.worldContext;
    return (context.kind === "wanderer-ambush" && context.finalStage === true)
        || context.kind === "questbook-boss"
        || context.kind === "story-reckoning";
}

function pendingMode(context: WorldAiFightContext): string {
    if (context.kind === "wanderer") return "single";
    if (context.kind === "wanderer-ambush") return "ambush";
    if (context.kind === "bounty-hunter") return "bountyHunter";
    if (context.kind === "hunt-pack") return "huntPack";
    if (context.kind === "hunt-target") return "huntTarget";
    if (context.kind === "questbook-boss") return "questboss";
    if (context.kind === "story-reckoning") return "storyReckoning";
    return context.kind;
}

export type WandererFightPresentation = {
    playerName: string;
    mode: string;
    sourceId: string;
    stage: number;
    sector: number;
    at: number;
    name?: string;
    level?: number;
    nemesis?: boolean;
    hostile?: boolean;
    hunterId?: string;
    hunterName?: string;
    bountyAmount?: number;
    storyReckoningId?: string;
    missionId?: string;
    /** Bundled/display-only combat portrait. Never used to rebuild identity,
     * stats, rewards, or chain authority; it only survives a tab refresh so a
     * resumed road encounter does not fall back to initials. */
    enemyAvatar?: string;
};

/** Derive the complete callback identity from the server seal. This is also the
 * private-browsing fallback when localStorage is unavailable. */
export function wandererFightPresentationFromContext(
    playerName: string,
    context: WorldAiFightContext,
): WandererFightPresentation {
    return {
        playerName,
        mode: pendingMode(context),
        sourceId: context.sourceId,
        stage: context.stage,
        sector: context.sector,
        name: context.displayName,
        nemesis: context.kind === "wanderer" && context.sourceId === "nemesis",
        hunterName: context.kind === "bounty-hunter" ? context.displayName : undefined,
        storyReckoningId: context.kind === "story-reckoning" ? context.sourceId : undefined,
        missionId: context.missionId ?? ((context.kind === "hunt-pack" || context.kind === "hunt-target") ? context.sourceId : undefined),
        at: Date.now(),
    };
}

/** Repair the local presentation record from server-sealed context. This is
 * called for both fresh starts and recovered active pointers. */
export function ensureWandererFightPending(
    playerName: string,
    context: WorldAiFightContext,
    enemyAvatar?: string,
): void {
    try {
        const existing = recoverWandererFightAvatar(playerName, context);
        localStorage.setItem(
            WANDERER_PENDING_KEY,
            JSON.stringify({
                ...wandererFightPresentationFromContext(playerName, context),
                ...((enemyAvatar || existing) ? { enemyAvatar: enemyAvatar || existing } : {}),
            }),
        );
    } catch { /* private mode: live settlement still resolves */ }
}

/** Recover only the portrait belonging to this exact server-sealed encounter.
 * The identity checks prevent a stale road NPC from lending its face to a new
 * fight; the value remains presentation-only. */
export function recoverWandererFightAvatar(
    playerName: string,
    context: WorldAiFightContext,
): string | undefined {
    try {
        const raw = localStorage.getItem(WANDERER_PENDING_KEY);
        if (!raw) return undefined;
        const record = JSON.parse(raw) as Partial<WandererFightPresentation>;
        const sameEncounter = record.playerName?.trim().toLowerCase() === playerName.trim().toLowerCase()
            && record.sourceId === context.sourceId
            && Number(record.stage) === context.stage
            && Number(record.sector) === context.sector
            && Date.now() - Number(record.at ?? 0) <= 30 * 60 * 1000;
        return sameEncounter && typeof record.enemyAvatar === "string" && record.enemyAvatar.trim()
            ? record.enemyAvatar
            : undefined;
    } catch {
        return undefined;
    }
}

/** Remove presentation recovery only for the account that just reconciled. */
export function clearWandererFightPending(playerName: string): void {
    try {
        const raw = localStorage.getItem(WANDERER_PENDING_KEY);
        if (!raw) return;
        const record = JSON.parse(raw) as Partial<WandererFightPresentation>;
        if (record.playerName?.trim().toLowerCase() !== playerName.trim().toLowerCase()) return;
        localStorage.removeItem(WANDERER_PENDING_KEY);
    } catch { /* private mode has no presentation marker to clear */ }
}

/** Persist and publish only a token-sealed server settlement. WorldMap listens
 * while mounted; the stored copy covers refresh/reconnect presentation recovery. */
export function stampWandererFightSettlement(settlement: WandererFightSettlement): void {
    try {
        const raw = localStorage.getItem(WANDERER_PENDING_KEY);
        if (raw) {
            const record = JSON.parse(raw) as Record<string, unknown>;
            record.result = settlement.outcome === "win" ? "win" : settlement.outcome === "forfeit" ? "fled" : "loss";
            // The live event carries the authoritative character snapshot. Keep
            // localStorage small and presentation-only: refresh recovery needs the
            // sealed identity/outcome, never a second copy of the full player save.
            record.settlement = {
                outcome: settlement.outcome,
                worldContext: settlement.worldContext,
                _saveVersion: settlement._saveVersion,
            } satisfies WandererFightSettlement;
            localStorage.setItem(WANDERER_PENDING_KEY, JSON.stringify(record));
        }
    } catch { /* private mode: live event still continues the encounter */ }
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<WandererFightSettlement>(WANDERER_FIGHT_SETTLED_EVENT, { detail: settlement }));
    }
}

/*
 * Pure client-side state machine + eligibility for the Kage Challenge Board.
 * Mirrors the server model (api/village/_kage-challenge.ts) — the server is
 * authoritative; this only decides what the Town Hall board renders. Keep the
 * constants in sync with _kage-challenge.ts.
 *
 * The old client vote/window model (support/opposition, 23:00-03:00 window,
 * ready-window) is gone — see the removal in lib/world-state.ts / village-state.ts.
 */
import type { Character } from "../types/character";

// MIRROR: api/village/_kage-challenge.ts KAGE_DECLARE_RYO_COST.
export const KAGE_CHALLENGE_RYO_COST = 250_000;
export const KAGE_CHALLENGE_MIN_LEVEL = 90;
export const KAGE_CHALLENGE_MIN_MERIT = 250;
export const KAGE_MIN_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type KageEndReason = "defeated" | "forfeit" | "admin-reset" | "abdicated";
export type ServerKageHistoryEntry = {
    name: string;
    village: string;
    seatedAt: number;
    endedAt?: number;
    endedReason?: KageEndReason;
    wonBy?: string;
    defenseCount?: number;
};
export type ServerKageChallenge = {
    challengeId?: string;
    challenger: string;
    status: "pending" | "accepted";
    createdAt: number;
    obligationRemainingMs: number;
    battleId?: string;
};
export type ServerKageState = {
    kageSystemUnlocked?: boolean;
    seatedKage?: string;
    firstLiberator?: string;
    unlockedAt?: number;
    seatedAt?: number;
    defenseCount?: number;
    history?: ServerKageHistoryEntry[];
    challenge?: ServerKageChallenge | null;
    postDefenseGraceUntil?: number;
};

export type KageEligibilityItem = { label: string; ok: boolean; detail?: string };
export type KageChallengeRole = "challenger" | "kage" | "bystander";

export type KageBoardState =
    | { kind: "SEALED" }
    | { kind: "GRACE_PERIOD"; graceUntil: number; isSeatedKage: boolean; seatedKage: string }
    | { kind: "NO_CHALLENGE"; isSeatedKage: boolean; seatedKage: string; eligibility: KageEligibilityItem[]; canDeclare: boolean }
    | { kind: "PENDING_CHALLENGE"; challenge: ServerKageChallenge; role: KageChallengeRole; seatedKage: string }
    | { kind: "ACCEPTED_DUEL"; challenge: ServerKageChallenge; role: KageChallengeRole; seatedKage: string };

function lower(s: string | undefined): string {
    return String(s ?? "").trim().toLowerCase();
}

/** Personal-merit + baseline eligibility the client can check (server re-enforces). */
export function kageEligibility(character: Character, now: number): KageEligibilityItem[] {
    const merit = Math.max(0, Math.floor(Number(character.villageMerit ?? 0)));
    const ryo = Math.max(0, Math.floor(Number(character.ryo ?? 0)));
    const accountAgeMs = now - Number(character.createdAt ?? now);
    return [
        { label: `Level ${KAGE_CHALLENGE_MIN_LEVEL}+`, ok: (character.level ?? 0) >= KAGE_CHALLENGE_MIN_LEVEL, detail: `Lv. ${character.level ?? 0}` },
        { label: "Account 7+ days old", ok: accountAgeMs >= KAGE_MIN_ACCOUNT_AGE_MS },
        { label: `${KAGE_CHALLENGE_RYO_COST.toLocaleString()} ryo`, ok: ryo >= KAGE_CHALLENGE_RYO_COST, detail: `${ryo.toLocaleString()}` },
        { label: `${KAGE_CHALLENGE_MIN_MERIT} Village Merit`, ok: merit >= KAGE_CHALLENGE_MIN_MERIT, detail: `${merit}/${KAGE_CHALLENGE_MIN_MERIT}` },
    ];
}

/**
 * Derive the single board state from authoritative server state + the viewer.
 * RESOLVED is not a distinct server state (the seat flips and the challenge is
 * cleared), so a just-settled challenge surfaces here as GRACE_PERIOD (new Kage)
 * or NO_CHALLENGE with the updated seat.
 */
export function deriveKageChallengeState(server: ServerKageState | null | undefined, character: Character, now: number): KageBoardState {
    if (!server || !server.kageSystemUnlocked || !server.seatedKage) return { kind: "SEALED" };
    const seatedKage = server.seatedKage;
    const isSeatedKage = lower(seatedKage) === lower(character.name);
    const challenge = server.challenge ?? null;

    if (challenge) {
        const role: KageChallengeRole = lower(challenge.challenger) === lower(character.name)
            ? "challenger"
            : isSeatedKage ? "kage" : "bystander";
        const kind = challenge.status === "accepted" ? "ACCEPTED_DUEL" : "PENDING_CHALLENGE";
        return { kind, challenge, role, seatedKage } as KageBoardState;
    }

    const graceUntil = server.postDefenseGraceUntil ?? 0;
    if (graceUntil > now) return { kind: "GRACE_PERIOD", graceUntil, isSeatedKage, seatedKage };

    const eligibility = kageEligibility(character, now);
    const canDeclare = !isSeatedKage && eligibility.every((e) => e.ok);
    return { kind: "NO_CHALLENGE", isSeatedKage, seatedKage, eligibility, canDeclare };
}

/** M:SS accept-obligation countdown. */
export function formatObligation(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

/** Coarse "Nd Nh" / "Nh Nm" / "Nm" relative span for grace / tenure displays. */
export function formatKageDuration(ms: number): string {
    const total = Math.max(0, ms);
    const d = Math.floor(total / 86_400_000);
    const h = Math.floor((total % 86_400_000) / 3_600_000);
    const m = Math.floor((total % 3_600_000) / 60_000);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export const KAGE_END_REASON_LABEL: Record<KageEndReason, string> = {
    defeated: "Defeated in a duel",
    forfeit: "Forfeited the seat",
    "admin-reset": "Seat reset",
    abdicated: "Stepped down",
};

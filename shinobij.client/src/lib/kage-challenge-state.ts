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

export type KageEndReason = "defeated" | "forfeit" | "admin-reset" | "abdicated" | "inactive";
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
    /** Seated Kage's last autosave (server-read); absent when unknown. */
    kageLastActiveAt?: number;
    /** When the seat is declared open if the Kage stays absent (kageLastActiveAt + 10 days). */
    kageInactiveAt?: number;
};

/** Stable identity for one eligibility requirement. Callers that need to single
 *  out a requirement (the vacant-seat claim stakes no ryo, so it drops `ryo`)
 *  MUST match on this id — matching on the label was a string test that broke
 *  silently the moment a cost or a wording was retuned. */
export type KageEligibilityId = 'level' | 'account-age' | 'ryo' | 'merit';

export type KageEligibilityItem = { id: KageEligibilityId; label: string; ok: boolean; detail?: string };
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
    // `?? 0`, NOT `?? now`. The server reads num(char.createdAt), which coerces a
    // missing field to 0 and therefore ACCEPTS the challenge. Defaulting to `now`
    // here made the same save read as too-new, so a save without createdAt saw a
    // blocker the server would have waved through.
    const accountAgeMs = now - Number(character.createdAt ?? 0);
    return [
        { id: 'level', label: `Level ${KAGE_CHALLENGE_MIN_LEVEL}+`, ok: (character.level ?? 0) >= KAGE_CHALLENGE_MIN_LEVEL, detail: `Lv. ${character.level ?? 0}` },
        { id: 'account-age', label: "Account 7+ days old", ok: accountAgeMs >= KAGE_MIN_ACCOUNT_AGE_MS },
        { id: 'ryo', label: `${KAGE_CHALLENGE_RYO_COST.toLocaleString()} ryo`, ok: ryo >= KAGE_CHALLENGE_RYO_COST, detail: `${ryo.toLocaleString()}` },
        { id: 'merit', label: `${KAGE_CHALLENGE_MIN_MERIT} Village Merit`, ok: merit >= KAGE_CHALLENGE_MIN_MERIT, detail: `${merit}/${KAGE_CHALLENGE_MIN_MERIT}` },
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
    inactive: "Seat declared open after 10 days of absence",
};

// ── Kage inactivity visibility (mirrors api/village/_kage-inactivity.ts) ──────
// An absent Kage loses the seat after KAGE_INACTIVITY_DAYS; the GET exposes the
// seated Kage's last autosave + the deadline so the village can see it coming.
export const KAGE_INACTIVITY_DAYS = 10;
const KAGE_INACTIVITY_WARN_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type KageActivityLines = { lastActive: string; warning?: string };

/** Small counts read as words in the Council register — "four days", not "4 days". */
const DAY_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
function dayWord(n: number): string {
    return DAY_WORD[n] ?? String(n);
}

/** The register's line on the seated Kage's absence, plus a warning within 3
 *  days of the deadline. `null` when unknown. Written as register prose rather
 *  than a log line — this is the Council speaking, not a telemetry readout. */
export function kageActivityLines(server: Pick<ServerKageState, "seatedKage" | "kageLastActiveAt" | "kageInactiveAt"> | null | undefined, now: number): KageActivityLines | null {
    if (!server?.seatedKage) return null;
    const lastActiveAt = Number(server.kageLastActiveAt);
    if (!Number.isFinite(lastActiveAt) || lastActiveAt <= 0) return null;
    const inactiveAt = Number.isFinite(Number(server.kageInactiveAt)) && Number(server.kageInactiveAt) > 0
        ? Number(server.kageInactiveAt)
        : lastActiveAt + KAGE_INACTIVITY_DAYS * DAY_MS;
    const daysAgo = Math.max(0, Math.floor((now - lastActiveAt) / DAY_MS));
    const lastActive = daysAgo === 0
        ? "The Kage walked the village today."
        : daysAgo === 1
            ? "The Kage has not been seen since yesterday."
            : `The Kage has not been seen in ${dayWord(daysAgo)} days.`;
    const daysLeft = Math.max(0, Math.ceil((inactiveAt - now) / DAY_MS));
    if (daysLeft > KAGE_INACTIVITY_WARN_DAYS) return { lastActive };
    const warning = daysLeft === 0
        ? "Should the silence hold, the council opens the seat at the next daily pass."
        : `Should the silence hold, the council opens the seat in ${dayWord(daysLeft)} day${daysLeft === 1 ? "" : "s"}.`;
    return { lastActive, warning };
}

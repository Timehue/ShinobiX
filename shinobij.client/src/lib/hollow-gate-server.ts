/**
 * Hollow Gate — client side of the server-authoritative run loop.
 *
 * Wires the inert Tier-1 endpoints (api/hollow-gate/{start,choose-augment,settle}
 * — see docs/hollow-gate-augments.md) into the live dive. Everything here is
 * mandatory in release gameplay. If the server is unreachable or no token is
 * minted, the dive stays blocked instead of falling back to client authority.
 *
 * Trust model: at START the server seals the run identity and entry snapshot.
 * Reward-bearing events append exact idempotent credits to the server run
 * ledger. SETTLE receives only extract/abandon intent and returns the committed
 * character; the browser never reports haul or combat truth.
 *
 * This module is pure data + fetch wrappers + React-setter orchestration; it owns
 * none of the dungeon logic, so App.tsx only needs one-line call sites.
 */
import type { Character, HollowGateShrineRun, HollowGateAugmentOffer, HollowGateTileKind } from "../types/character";
import { sealHollowGateFloor } from "./hollow-gate-event-api";

export type HollowGateOutcome = "extract" | "death";

// ── Feature flag ──────────────────────────────────────────────────────────────
// The server-authoritative run loop is mandatory in the browser. The false value
// in non-browser test/SSR contexts prevents orchestration helpers from attempting
// network calls while keeping shipped gameplay non-downgradable.
export function hollowGateServerEnabled(): boolean {
    return typeof window !== "undefined";
}

// ── Modal shape (structurally compatible with App's HollowGateEventModal) ──────
export type HollowGateModalChoice = { label: string; onSelect: () => void; tone?: "danger" | "safe" | "primary" };
export type HollowGateModal = { title: string; body: string; kind: HollowGateTileKind; choices: HollowGateModalChoice[] };

// ── Endpoint payload shapes ────────────────────────────────────────────────────
export type HollowGateStartResult = {
    ok: boolean;
    token?: string | null;
    seed?: string;
    floorDepth?: number;
    variantId?: string;
    floorWidth?: number;
    floorHeight?: number;
    bossProfileId?: string;
    bossName?: string;
    chosenAugmentId?: string | null;
    augmentOffers?: HollowGateAugmentOffer[];
    reason?: string;
    error?: string;
    character?: Character;
    _saveVersion?: number;
};
export type HollowGateSettleResult = {
    ok: boolean;
    outcome?: HollowGateOutcome;
    credited?: Partial<Record<string, number>>;
    character?: Character | null;
    _saveVersion?: number;
    reason?: string;
    alreadyReported?: boolean;
    error?: string;
};

// ── Fetch wrappers (auth headers are auto-attached by installAuthFetch) ─────────
export async function startHollowGateServerRun(playerName: string, floorDepth: number, variantId?: string, recoveryRequestId?: string): Promise<HollowGateStartResult | null> {
    if (!playerName) return null;
    const requestId = recoveryRequestId && /^[A-Za-z0-9:_-]{8,96}$/.test(recoveryRequestId)
        ? recoveryRequestId
        : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `hg-start-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const r = await fetch("/api/hollow-gate/start", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerName, floorDepth, variantId, requestId }),
            });
            const data = (await r.json().catch(() => ({}))) as HollowGateStartResult;
            if (!r.ok) return { ...data, ok: false, reason: data.reason || data.error || `start-failed-${r.status}` };
            return data;
        } catch {
            if (attempt === 1) return null;
        }
    }
    return null;
}

export async function chooseHollowGateAugment(playerName: string, token: string, augmentId: string): Promise<string | null> {
    if (!playerName || !token || !augmentId) return null;
    try {
        const r = await fetch("/api/hollow-gate/choose-augment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, augmentId }),
        });
        if (!r.ok) return null;
        const data = (await r.json()) as { ok?: boolean; chosenAugmentId?: string };
        return data?.ok && data.chosenAugmentId ? data.chosenAugmentId : null;
    } catch { return null; }
}

export async function settleHollowGateRun(
    playerName: string,
    token: string,
    outcome: HollowGateOutcome,
): Promise<HollowGateSettleResult | null> {
    if (!playerName || !token) return null;
    try {
        const r = await fetch("/api/hollow-gate/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, action: outcome === "death" ? "abandon" : "extract" }),
        });
        const data = await r.json().catch(() => ({})) as HollowGateSettleResult;
        if (!r.ok || !data.ok) {
            return { ...data, ok: false, error: data.error || data.reason || `Hollow Gate settlement failed (${r.status}).` };
        }
        return data;
    } catch {
        return { ok: false, error: "The Hollow Gate settlement service is unreachable." };
    }
}

export async function requestHollowGateServerConsumable(
    playerName: string,
    token: string,
    action: "reignite" | "skeleton-key" | "hollow-ward" | "diviner-eye" | "sanctify" | "arm-second-wind",
    requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `hg-consumable-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): Promise<{ ok: boolean; character?: Character; entryCurrencies?: Partial<Record<string, number>>; secondWindArmed?: boolean; runState?: { keys: number; torch: number; threat: number; wardSteps: number; divinerUsed: boolean; secondWindArmed: boolean }; error?: string; alreadyReported?: boolean } | null> {
    if (!playerName || !token) return null;
    try {
        const response = await fetch("/api/hollow-gate/use-consumable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, action, requestId }),
        });
        const data = await response.json().catch(() => ({})) as { ok?: boolean; character?: Character; entryCurrencies?: Partial<Record<string, number>>; secondWindArmed?: boolean; runState?: { keys: number; torch: number; threat: number; wardSteps: number; divinerUsed: boolean; secondWindArmed: boolean }; error?: string; alreadyReported?: boolean };
        return response.ok && data.ok ? { ...data, ok: true } : { ...data, ok: false };
    } catch {
        return null;
    }
}

/** Adopt the complete character returned by authoritative settlement. */
export function reconcileHollowGateSettle(
    character: Character,
    result: HollowGateSettleResult,
): Character {
    if (result.character) return { ...character, ...result.character };
    return character;
}

// ── Expired-run escape ─────────────────────────────────────────────────────────
// A missing run token means the run was already settled/closed. If a stale local
// save still carries it, the server
// deliberately no-retreat (lib/screen-guards.ts) — so the player was restored into
// a dead gate on every load, handed a dismissable error, and left with no way out.
// (Reproduced live 2026-07-17; freeing the account took a manual DB edit.) The
// dismiss path must therefore CLEAR the run, not merely close the dialog.

/** Recognise the server's "this run is gone" replies — see the
 *  HOLLOW_GATE_RUN_EXPIRED_MESSAGES list in api/hollow-gate/_run-token.ts. A drift
 *  test imports that list and asserts every message it can send matches here. */
export function isHollowGateRunExpiredMessage(message: unknown): boolean {
    return /hollow gate run (has )?expired/i.test(String(message ?? ""));
}

/** Drop a dead run from the character. `null`, NEVER `undefined`: this rides out on
 *  the JSON autosave, which strips undefined-valued keys — an absent key leaves the
 *  server's mergePreservingImages seeding from the STORED record, which resurrects
 *  the very run we are trying to clear. (The server-side self-heal in
 *  api/_elapsed-state.ts has the mirror-image constraint: there `undefined` is the
 *  own key that overrides, and `delete` is what resurrects.) */
export function clearHollowGateRunLocal(character: Character): Character {
    return { ...character, hollowGateRun: null };
}

/** Surface a run error; on an EXPIRED run also fire `onExpired` to free the player.
 *  Returns whether the run was closed. The authoritative endpoint already owns
 *  economy reconciliation; this only releases stale UI state. */
export function reportHollowGateRunError(
    error: unknown,
    fallback: string,
    onExpired: () => void,
    notify: (message: string) => void = (m) => { if (typeof window !== "undefined") window.alert(m); },
): boolean {
    const message = error instanceof Error && error.message ? error.message : fallback;
    if (!isHollowGateRunExpiredMessage(message)) { notify(message); return false; }
    notify(`${message}\n\nThis dive can no longer be settled, so the shrine has released its hold — returning you to the world map.`);
    onExpired();
    return true;
}

// Client projection used only for run presentation (retreat/Keeper affordances).
// The Solo PvE encounter builder and engine independently derive and enforce the
// combat effects from the server token.
export type HollowGateAugmentEffects = {
    enemyHpMult: number;      // >1 = tougher enemy (Greedy Pact "enemies +30% power")
    enemyStatMult: number;    // <1 = enemy hits softer (Warded Step "shield")
    enemyHpShavePct: number;  // 0..0.9 = enemy enters with less HP ("you deal more")
    noRetreat: boolean;       // disable the Leave tile (Berserker's Gamble)
    noKeeperHeal: boolean;    // Shrine Keeper won't heal (Treasure Sense "fewer heals")
};

const NO_AUGMENT_EFFECTS: HollowGateAugmentEffects = {
    enemyHpMult: 1, enemyStatMult: 1, enemyHpShavePct: 0, noRetreat: false, noKeeperHeal: false,
};
const clampShave = (n: number): number => Math.max(0, Math.min(0.9, n));

/** Map the chosen augment to HG-local battle/run modifiers. Reads combat.value from
 *  the server-sent augment so the numbers track the catalog. Returns all-neutral
 *  when no augment is chosen (no-token / flag-off runs). */
export function hollowGateAugmentEffects(run: HollowGateShrineRun | null | undefined): HollowGateAugmentEffects {
    const a = run?.chosenAugment;
    if (!a) return NO_AUGMENT_EFFECTS;
    const v = Math.max(0, a.combat?.value ?? 0);
    switch (a.id) {
        case "greedy-pact":       return { ...NO_AUGMENT_EFFECTS, enemyHpMult: 1 + v, enemyStatMult: 1 + v };       // enemyPower
        case "keen-edge":         return { ...NO_AUGMENT_EFFECTS, enemyHpShavePct: clampShave(v / (1 + v)) };       // +dmg → less enemy HP
        case "warded-step":       return { ...NO_AUGMENT_EFFECTS, enemyStatMult: Math.max(0.5, 1 - v) };            // shield → softer hits
        case "chain-reaction":    return { ...NO_AUGMENT_EFFECTS, enemyHpShavePct: v > 0 ? 0.15 : 0 };              // arc (no 2nd foe in 1v1) → flat extra dmg
        case "berserkers-gamble": return { ...NO_AUGMENT_EFFECTS, enemyHpShavePct: clampShave(v), noRetreat: true }; // damage bonus + no retreat
        case "treasure-sense":    return { ...NO_AUGMENT_EFFECTS, noKeeperHeal: true };                             // fewer heals
        default:                  return NO_AUGMENT_EFFECTS;
    }
}

// ── Server-owned run-end settlement ─────────────────────────────────────────────

type SetCharacter = (updater: (prev: Character | null) => Character | null) => void;

/** Settle server-owned run state and reconcile the returned character. */
export async function settleHollowGateRunOnly(
    run: HollowGateShrineRun | null,
    outcome: HollowGateOutcome,
    character: Character,
    setCharacter: SetCharacter,
): Promise<HollowGateSettleResult | null> {
    if (!run?.runToken || !hollowGateServerEnabled()) return null;
    const token = run.runToken;
    const res = await settleHollowGateRun(character.name, token, outcome);
    if (!res?.ok || !res.character) return res?.ok ? { ...res, ok: false, error: "Settlement returned no committed character." } : res;
    setCharacter((prev) => {
        if (!prev) return prev;
        return reconcileHollowGateSettle(prev, res);
    });
    return res;
}

/** Finish a run only after the server returns its committed character. */
export async function finalizeHollowGateRunEnd(opts: {
    run: HollowGateShrineRun | null;
    outcome: HollowGateOutcome;
    character: Character;
    setCharacter: SetCharacter;
}): Promise<HollowGateSettleResult> {
    const { run, outcome, character, setCharacter } = opts;
    if (!run?.runToken || !hollowGateServerEnabled()) {
        throw new Error("This Hollow Gate run has no valid server settlement token.");
    }
    const result = await settleHollowGateRunOnly(run, outcome, character, setCharacter);
    if (!result?.ok) {
        throw new Error(result?.error || result?.reason || "The Hollow Gate could not settle this run.");
    }
    setCharacter((prev) => {
        if (!prev) return prev;
        return reconcileHollowGateSettle(prev, result);
    });
    return result;
}

// ── Augment picker (reuses App's hollowGateEvent modal — no new render JSX) ─────

export function buildAugmentPickerEvent(
    offers: HollowGateAugmentOffer[],
    onPick: (offer: HollowGateAugmentOffer) => void,
): HollowGateModal {
    return {
        title: "Choose Your Hollow Gate Augment",
        body: "A boon stirs in the dark — choose one to shape this descent. Richer hauls demand greater risk; the shrine remembers what you take.",
        kind: "shrine",
        choices: offers.map((o) => ({
            label: `${o.label}${o.riskLabel ? ` — ${o.riskLabel}` : ""}`,
            tone: o.rarity === "rare" ? "danger" : "primary",
            onSelect: () => onPick(o),
        })),
    };
}

// ── Entry orchestrator ──────────────────────────────────────────────────────────

type SetRun = (updater: (prev: HollowGateShrineRun | null) => HollowGateShrineRun | null) => void;

export type HollowGateAttachOpts = {
    playerName: string;
    setRun: SetRun;
    setCharacter: SetCharacter;
    setEvent: (e: HollowGateModal | null) => void;
    pushLog: (line: string) => void;
};

/** Attach a minted run token (+ rolled offers) to the live run and present the
 * augment picker. A missing token is a hard stop at each caller; this helper
 * never creates a local-authority fallback. */
export function attachStartedRun(res: HollowGateStartResult | null, opts: HollowGateAttachOpts): void {
    if (!res?.token) return;
    const token = res.token;
    const patch: Partial<HollowGateShrineRun> = { runToken: token, serverSeed: res.seed, augmentOffers: res.augmentOffers ?? [] };
    // Attach to whatever the live run/character is now (resilient to a step taken
    // while start was in flight); skip if the run already ended.
    opts.setRun((prev) => (prev && !prev.completed ? { ...prev, ...patch } : prev));
    opts.setCharacter((prev) =>
        prev?.hollowGateRun && !prev.hollowGateRun.completed
            ? { ...prev, hollowGateRun: { ...prev.hollowGateRun, ...patch } }
            : prev,
    );
    const offers = res.augmentOffers ?? [];
    if (offers.length === 0) return;
    presentAugmentPicker({ playerName: opts.playerName, token, offers, setRun: opts.setRun, setCharacter: opts.setCharacter, setEvent: opts.setEvent, pushLog: opts.pushLog });
}

/** On RESUME of an in-progress run: if it carries a server token, was minted with
 *  augment offers, and the player never chose one (e.g. they refreshed during the
 *  pick), re-present the picker. Never re-calls start — that would double-count the
 *  daily-run counter; it only re-offers what the server already rolled. No-op when
 *  the flag is off, the run is token-less, or an augment was already chosen. */
/** Pure: should resume re-present the picker? True iff the run carries a server
 *  token, was minted with offers, and no augment was chosen yet. (The flag check
 *  is separate so this stays window-free + unit-testable.) */
export function shouldResumeAugmentPicker(run: HollowGateShrineRun | null | undefined): boolean {
    return Boolean(run?.runToken) && !run?.chosenAugment && Boolean(run?.augmentOffers?.length);
}

export function resumeHollowGateServerRun(opts: {
    playerName: string;
    run: HollowGateShrineRun | null | undefined;
    setRun: SetRun;
    setCharacter: SetCharacter;
    setEvent: (e: HollowGateModal | null) => void;
    pushLog: (line: string) => void;
}): void {
    const run = opts.run;
    if (run?.runToken) {
        void sealHollowGateFloor(opts.playerName, run.runToken, run).then((result) => {
            if (!result.ok) opts.pushLog(result.error || "The saved Hollow Gate floor could not be resealed.");
        });
    }
    if (!hollowGateServerEnabled() || !shouldResumeAugmentPicker(run)) return;
    presentAugmentPicker({
        playerName: opts.playerName,
        token: run?.runToken ?? "",
        offers: run?.augmentOffers ?? [],
        setRun: opts.setRun,
        setCharacter: opts.setCharacter,
        setEvent: opts.setEvent,
        pushLog: opts.pushLog,
    });
}

/** Present the augment picker via the run-event modal and wire the choose flow.
 * Shared by entry and resume. No-op for empty offers. */
function presentAugmentPicker(opts: {
    playerName: string;
    token: string;
    offers: HollowGateAugmentOffer[];
    setRun: SetRun;
    setCharacter: SetCharacter;
    setEvent: (e: HollowGateModal | null) => void;
    pushLog: (line: string) => void;
}): void {
    if (opts.offers.length === 0) return;
    opts.setEvent(
        buildAugmentPickerEvent(opts.offers, (offer) => {
            void chooseHollowGateAugment(opts.playerName, opts.token, offer.id).then((chosenId) => {
                opts.setEvent(null);
                const chosen = opts.offers.find((candidate) => candidate.id === chosenId);
                const ok = Boolean(chosen);
                if (chosen) offer = chosen;
                if (!ok) { opts.pushLog("The shrine did not seal an augment. Choose again after reconnecting."); return; }
                opts.setRun((prev) => (prev ? { ...prev, chosenAugment: offer } : prev));
                opts.setCharacter((prev) =>
                    prev?.hollowGateRun ? { ...prev, hollowGateRun: { ...prev.hollowGateRun, chosenAugment: offer } } : prev,
                );
                opts.pushLog(`Augment attuned: ${offer.label}.${offer.riskLabel ? ` (${offer.riskLabel})` : ""}`);
            });
        }),
    );
}

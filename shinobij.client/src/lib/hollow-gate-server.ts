/**
 * Hollow Gate — client side of the server-authoritative run loop.
 *
 * Wires the inert Tier-1 endpoints (api/hollow-gate/{start,choose-augment,settle}
 * — see docs/hollow-gate-augments.md) into the live dive. Everything here is
 * mandatory in release gameplay. If the server is unreachable or no token is
 * minted, the dive stays blocked instead of falling back to client authority.
 *
 * Trust model: at START the server seals the entry-currency snapshot + dive
 * depth + the chosen augment's REWARD multiplier into a single-use token. At
 * SETTLE it credits min(client-claimed, server-ceiling) anchored to the sealed
 * snapshot. We then MIRROR the server-credited balances onto the local character
 * (the same reconcile pattern as claim-mission / report-pet-event). The augment's
 * COMBAT effect is applied client-side for feel only and is never trusted.
 *
 * This module is pure data + fetch wrappers + React-setter orchestration; it owns
 * none of the dungeon logic, so App.tsx only needs one-line call sites.
 */
import type { Character, HollowGateShrineRun, HollowGateAugmentOffer, HollowGateTileKind } from "../types/character";
import { HOLLOW_GATE_CLAWBACK_KEYS, clawBackHollowGateLoot } from "./hollow-gate-run";

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
    augmentOffers?: HollowGateAugmentOffer[];
    reason?: string;
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

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Fetch wrappers (auth headers are auto-attached by installAuthFetch) ─────────
export async function startHollowGateServerRun(playerName: string, floorDepth: number, variantId?: string): Promise<HollowGateStartResult | null> {
    if (!playerName) return null;
    try {
        const r = await fetch("/api/hollow-gate/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, floorDepth, variantId }),
        });
        if (!r.ok) return null;
        return (await r.json()) as HollowGateStartResult;
    } catch { return null; }
}

export async function chooseHollowGateAugment(playerName: string, token: string, augmentId: string): Promise<boolean> {
    if (!playerName || !token || !augmentId) return false;
    try {
        const r = await fetch("/api/hollow-gate/choose-augment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, augmentId }),
        });
        if (!r.ok) return false;
        const data = (await r.json()) as { ok?: boolean };
        return Boolean(data?.ok);
    } catch { return false; }
}

export async function settleHollowGateRun(
    playerName: string,
    token: string,
    outcome: HollowGateOutcome,
    haul: Record<string, number>,
): Promise<HollowGateSettleResult | null> {
    if (!playerName || !token) return null;
    try {
        const r = await fetch("/api/hollow-gate/settle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, outcome, haul }),
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
    action: "sanctify" | "arm-second-wind" | "consume-second-wind",
): Promise<{ ok: boolean; character?: Character; entryCurrencies?: Partial<Record<string, number>>; secondWindArmed?: boolean; error?: string; alreadyReported?: boolean } | null> {
    if (!playerName || !token) return null;
    try {
        const response = await fetch("/api/hollow-gate/use-consumable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, token, action }),
        });
        const data = await response.json().catch(() => ({})) as { ok?: boolean; character?: Character; entryCurrencies?: Partial<Record<string, number>>; secondWindArmed?: boolean; error?: string; alreadyReported?: boolean };
        return response.ok && data.ok ? { ...data, ok: true } : { ...data, ok: false };
    } catch {
        return null;
    }
}

export function consumeHollowGateServerSecondWind(playerName: string, token?: string): void {
    if (!token) return;
    void requestHollowGateServerConsumable(playerName, token, "consume-second-wind");
}

// ── Pure reward helpers ─────────────────────────────────────────────────────────

/** Gross run haul (current − entry, floored at 0) per clawback currency. This is
 *  the CLAIMED amount we report to settle; the server clamps it to its ceiling. */
export function computeHollowGateHaul(character: Character, entry?: Partial<Record<string, number>>, run?: HollowGateShrineRun | null): Record<string, number> {
    const out: Record<string, number> = {};
    const c = character as Record<string, unknown>;
    for (const k of HOLLOW_GATE_CLAWBACK_KEYS) {
        out[k] = Math.max(0, num(c[k]) - num(entry?.[k]));
    }
    out.xp = Math.max(0, Math.floor(num(run?.earnedXp)));
    out.fragments = Math.max(0, Math.floor(num(run?.earnedFragments)));
    out.veils = Math.max(0, Math.floor(num(run?.earnedVeils)));
    return out;
}

/** Mirror the SERVER-credited haul onto the local character: each clawback
 *  currency becomes entry + credited (the exact value settle persisted). For a
 *  legit run this equals the live total (no visible change); a crafted client
 *  is reconciled DOWN to the sealed ceiling. Non-currency rewards (XP, pets,
 *  unique items) are untouched — settle never claws those. */
export function applyServerSettle(
    character: Character,
    entry: Partial<Record<string, number>> | undefined,
    credited: Partial<Record<string, number>>,
): Character {
    const next = { ...(character as Record<string, unknown>) };
    for (const k of HOLLOW_GATE_CLAWBACK_KEYS) {
        if (credited[k] === undefined) continue;
        next[k] = num(entry?.[k]) + Math.max(0, num(credited[k]));
    }
    return next as unknown as Character;
}

/** Adopt the full committed save when available. Reconstructing credited balances
 *  remains only as a rolling-deploy fallback for an older API response. */
export function reconcileHollowGateSettle(
    character: Character,
    entry: Partial<Record<string, number>> | undefined,
    result: HollowGateSettleResult,
): Character {
    if (result.character) return { ...character, ...result.character };
    return result.credited ? applyServerSettle(character, entry, result.credited) : character;
}

// ── Expired-run escape ─────────────────────────────────────────────────────────
// A run token lives 24h (api/hollow-gate/_run-token.ts). Once it lapses the server
// 409s every action, but the run itself persists on the SAVE and the shrine is
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
 *  Returns whether the run was expired. Nothing is settled or clawed back: the token
 *  is gone, so the server can no longer credit the dive in either direction, and the
 *  in-run haul was never banked (the HG currencies are server-ledger fields that the
 *  save sanitizer freezes for generic saves). So the run is simply void. */
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

/** Today's CLIENT-side run-end result (the no-token fallback). Death claws back
 *  (1 − retention) of the run's haul; extract keeps everything. Always clears the
 *  run. Identical to the prior inline App.tsx expression. */
export function applyHollowGateRunEndLocal(
    prev: Character,
    run: HollowGateShrineRun | null,
    outcome: HollowGateOutcome,
    lootRetention: number,
): Character {
    const base = outcome === "death" && run ? clawBackHollowGateLoot(prev, run, 1 - lootRetention) : prev;
    return { ...base, hollowGateRun: null } as Character;
}

// ── Augment combat-feel (HG-ONLY) ───────────────────────────────────────────────
// The reward multiplier is enforced server-side; THIS is the untrusted client-side
// FEEL. Every effect is applied only to the per-dive enemy clone (startHollowGate
// battle) or HG run handlers — NEVER the shared PvP/PvE combat engine — so nothing
// outside the Hollow Gate can be affected. Effects that don't map onto HG's 1v1 /
// no-heal structure are translated to the closest HG-local equivalent (e.g. "+20%
// player damage" → the enemy enters with proportionally less HP).
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

// ── Run-end settle (background, flag-gated, no-op without a token) ───────────────

type SetCharacter = (updater: (prev: Character | null) => Character | null) => void;

/** Fire-and-forget settle + reconcile. Safe no-op if the flag is off or the run
 *  carries no server token. `characterForHaul` is the PRE-claw-back character
 *  (so the claimed haul is the gross run total). */
export async function settleHollowGateRunOnly(
    run: HollowGateShrineRun | null,
    outcome: HollowGateOutcome,
    characterForHaul: Character,
    setCharacter: SetCharacter,
): Promise<HollowGateSettleResult | null> {
    if (!run?.runToken || !hollowGateServerEnabled()) return null;
    const token = run.runToken;
    const entry = run.entryCurrencies;
    const haul = computeHollowGateHaul(characterForHaul, entry, run);
    const res = await settleHollowGateRun(characterForHaul.name, token, outcome, haul);
    if (!res?.ok) return res;
    setCharacter((prev) => {
        if (!prev) return prev;
        // Prefer the full stored character. The credited-balance fallback keeps
        // compatibility with an older server during a rolling deployment.
        return reconcileHollowGateSettle(prev, entry, res);
    });
    return res;
}

/** The combined run-end funnel: applies today's local result IMMEDIATELY (so the
 *  UI is correct and save-safe even if settle never runs) and reconciles to the
 *  server credit in the background. Replaces the inline claw-back at the run-end
 *  call sites one-for-one. */
export async function finalizeHollowGateRunEnd(opts: {
    run: HollowGateShrineRun | null;
    outcome: HollowGateOutcome;
    character: Character;
    lootRetention: number;
    setCharacter: SetCharacter;
}): Promise<HollowGateSettleResult> {
    const { run, outcome, character, lootRetention, setCharacter } = opts;
    if (!run?.runToken || !hollowGateServerEnabled()) {
        throw new Error("This Hollow Gate run has no valid server settlement token.");
    }
    const result = await settleHollowGateRunOnly(run, outcome, character, setCharacter);
    if (!result?.ok) {
        throw new Error(result?.error || result?.reason || "The Hollow Gate could not settle this run.");
    }
    // The API clears hollowGateRun atomically with its economy write. Keep the
    // fallback for rolling deployments that return only credited balances.
    setCharacter((prev) => {
        if (!prev) return prev;
        const reconciled = reconcileHollowGateSettle(prev, run.entryCurrencies, result);
        return reconciled.hollowGateRun == null
            ? reconciled
            : applyHollowGateRunEndLocal(reconciled, run, outcome, lootRetention);
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
 *  augment picker. No-op when start returned no token (daily-cap / unreachable /
 *  SESSION unset → token-less fallback). Shared by the background entry and the
 *  hard-blocking entry (which awaits start ITSELF before consuming the Key, so the
 *  server daily-cap actually gates entry — audit #7). */
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

/** Background entry: mints the run token, attaches it + presents the picker. Used by
 *  the admin test entry (which bypasses the daily cap). The live player entry instead
 *  AWAITS startHollowGateServerRun directly so a 'daily-cap' reply blocks the dive
 *  before the Key is spent. No-op / token-less fallback if the flag is off. */
export async function beginHollowGateServerRun(opts: HollowGateAttachOpts & { floorDepth: number; variantId?: string }): Promise<void> {
    if (!hollowGateServerEnabled()) return;
    const res = await startHollowGateServerRun(opts.playerName, opts.floorDepth, opts.variantId);
    attachStartedRun(res, opts);
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
 *  Shared by entry (beginHollowGateServerRun) and resume. No-op for empty offers. */
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
            void chooseHollowGateAugment(opts.playerName, opts.token, offer.id).then((ok) => {
                opts.setEvent(null);
                if (!ok) { opts.pushLog("The shrine spurns your offering — you descend unaugmented."); return; }
                opts.setRun((prev) => (prev ? { ...prev, chosenAugment: offer } : prev));
                opts.setCharacter((prev) =>
                    prev?.hollowGateRun ? { ...prev, hollowGateRun: { ...prev.hollowGateRun, chosenAugment: offer } } : prev,
                );
                opts.pushLog(`Augment attuned: ${offer.label}.${offer.riskLabel ? ` (${offer.riskLabel})` : ""}`);
            });
        }),
    );
}

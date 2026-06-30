/**
 * Hollow Gate — client side of the server-authoritative run loop.
 *
 * Wires the inert Tier-1 endpoints (api/hollow-gate/{start,choose-augment,settle}
 * — see docs/hollow-gate-augments.md) into the live dive. Everything here is
 * behind the `hollowGateServer.v1` flag (default OFF) and degrades gracefully:
 * if the flag is off, the server is unreachable, or no token is minted
 * (SESSION_SECRET unset / daily-cap), the run falls back to the existing
 * client-authoritative path verbatim — nothing breaks (token-first invariant).
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
// Default OFF until the loop is playtested. Opt IN per-device with localStorage
// `hollowGateServer.v1 = "on"`. (Most flags here default ON and opt out; this one
// is an anti-cheat/economy change, so it stays OFF until deliberately enabled.)
export function hollowGateServerEnabled(): boolean {
    try { return window.localStorage?.getItem("hollowGateServer.v1") === "on"; } catch { return false; }
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
};
export type HollowGateSettleResult = {
    ok: boolean;
    outcome?: HollowGateOutcome;
    credited?: Partial<Record<string, number>>;
    reason?: string;
    alreadyReported?: boolean;
};

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// ── Fetch wrappers (auth headers are auto-attached by installAuthFetch) ─────────
export async function startHollowGateServerRun(playerName: string, floorDepth: number): Promise<HollowGateStartResult | null> {
    if (!playerName) return null;
    try {
        const r = await fetch("/api/hollow-gate/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName, floorDepth }),
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
        if (!r.ok) return null;
        return (await r.json()) as HollowGateSettleResult;
    } catch { return null; }
}

// ── Pure reward helpers ─────────────────────────────────────────────────────────

/** Gross run haul (current − entry, floored at 0) per clawback currency. This is
 *  the CLAIMED amount we report to settle; the server clamps it to its ceiling. */
export function computeHollowGateHaul(character: Character, entry?: Partial<Record<string, number>>): Record<string, number> {
    const out: Record<string, number> = {};
    const c = character as Record<string, unknown>;
    for (const k of HOLLOW_GATE_CLAWBACK_KEYS) {
        out[k] = Math.max(0, num(c[k]) - num(entry?.[k]));
    }
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
        case "berserkers-gamble": return { ...NO_AUGMENT_EFFECTS, enemyHpShavePct: clampShave(v), noRetreat: true }; // lifesteal + no retreat
        case "treasure-sense":    return { ...NO_AUGMENT_EFFECTS, noKeeperHeal: true };                             // fewer heals
        default:                  return NO_AUGMENT_EFFECTS;
    }
}

// ── Run-end settle (background, flag-gated, no-op without a token) ───────────────

type SetCharacter = (updater: (prev: Character | null) => Character | null) => void;

/** Fire-and-forget settle + reconcile. Safe no-op if the flag is off or the run
 *  carries no server token. `characterForHaul` is the PRE-claw-back character
 *  (so the claimed haul is the gross run total). */
export function settleHollowGateRunOnly(
    run: HollowGateShrineRun | null,
    outcome: HollowGateOutcome,
    characterForHaul: Character,
    setCharacter: SetCharacter,
): void {
    if (!run?.runToken || !hollowGateServerEnabled()) return;
    const token = run.runToken;
    const entry = run.entryCurrencies;
    const haul = computeHollowGateHaul(characterForHaul, entry);
    void settleHollowGateRun(characterForHaul.name, token, outcome, haul).then((res) => {
        if (res?.ok && res.credited) {
            setCharacter((prev) => (prev ? applyServerSettle(prev, entry, res.credited!) : prev));
        }
    });
}

/** The combined run-end funnel: applies today's local result IMMEDIATELY (so the
 *  UI is correct and save-safe even if settle never runs) and reconciles to the
 *  server credit in the background. Replaces the inline claw-back at the run-end
 *  call sites one-for-one. */
export function finalizeHollowGateRunEnd(opts: {
    run: HollowGateShrineRun | null;
    outcome: HollowGateOutcome;
    character: Character;
    lootRetention: number;
    setCharacter: SetCharacter;
}): void {
    const { run, outcome, character, lootRetention, setCharacter } = opts;
    setCharacter((prev) => (prev ? applyHollowGateRunEndLocal(prev, run, outcome, lootRetention) : prev));
    settleHollowGateRunOnly(run, outcome, character, setCharacter);
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

/** Called right after a fresh run is created. Mints the server run token in the
 *  background, attaches it (+ the rolled augment offers) to the run, and presents
 *  the augment picker via the existing hollowGateEvent modal. Fully optional: if
 *  the flag is off or no token is minted, this is a no-op and the run proceeds
 *  token-less (the existing client-authoritative path). */
export async function beginHollowGateServerRun(opts: {
    playerName: string;
    floorDepth: number;
    setRun: SetRun;
    setCharacter: SetCharacter;
    setEvent: (e: HollowGateModal | null) => void;
    pushLog: (line: string) => void;
}): Promise<void> {
    if (!hollowGateServerEnabled()) return;
    const res = await startHollowGateServerRun(opts.playerName, opts.floorDepth);
    // daily-cap / unreachable / no SESSION_SECRET → token-less fallback (today's run).
    if (!res || !res.token) return;
    const token = res.token;
    const patch: Partial<HollowGateShrineRun> = {
        runToken: token,
        serverSeed: res.seed,
        augmentOffers: res.augmentOffers ?? [],
    };
    // Attach to whatever the live run/character is now (resilient to a step taken
    // while start was in flight); skip if the run already ended.
    opts.setRun((prev) => (prev && !prev.completed ? { ...prev, ...patch } : prev));
    opts.setCharacter((prev) =>
        prev?.hollowGateRun && !prev.hollowGateRun.completed
            ? { ...prev, hollowGateRun: { ...prev.hollowGateRun, ...patch } }
            : prev,
    );

    presentAugmentPicker({
        playerName: opts.playerName,
        token,
        offers: res.augmentOffers ?? [],
        setRun: opts.setRun,
        setCharacter: opts.setCharacter,
        setEvent: opts.setEvent,
        pushLog: opts.pushLog,
    });
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
            opts.setEvent(null);
            void chooseHollowGateAugment(opts.playerName, opts.token, offer.id).then((ok) => {
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

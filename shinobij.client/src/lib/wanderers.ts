/*
 * Sector Wanderers — AI shinobi that roam a sector looking like players.
 *
 * This module is the PURE, testable core: a per-sector roster that is generated
 * deterministically from (sector, dayBucket) so the cast of a sector is stable
 * for a while and refreshes on a believable clock — no flicker, no server round
 * trip, no save state. Rendering + movement live in <SectorWanderer>; the
 * encounter wiring (and the only thing that touches combat) lives in <WorldMap>.
 *
 * Scope (always on — a gameplay layer, not a per-device toggle): wanderers
 * spawn, walk/patrol/approach, and the ones whose function is to ROB/ATTACK
 * launch a fight when they reach the player. Gift / gamble archetypes just greet
 * for now (their reward economy is a later, server-authoritative phase — see
 * docs/sector-wanderers-plan.md §5).
 *
 * See also docs/sector-wanderers-content.md for the written character voice.
 */
// The roster roll itself lives in shared/wanderer-roster.ts so the SERVER
// re-derives the identical cast (api/sector/_wanderer-encounter.ts). Everything
// is re-exported here so existing `lib/wanderers` imports keep working.
export {
    WANDERER_ARCHETYPES, WANDERER_GRID, WANDERER_BUCKET_MS, WANDERER_MAX_INDEX, WANDERER_SECTOR_COUNT,
    wandererDayBucketFromMs, wandererSeedFrom, wandererHash32, mulberry32, wandererPresenceGate,
    wandererLevelFor, wandererCount, rollWanderers, parseWandererId, resolveWandererById,
    wandererRelocationSector, relocateWandererInto,
    type Wanderer, type WandererVerb, type WandererArchetypeId, type WandererArchetypeMeta,
} from "../../../shared/wanderer-roster";
import {
    rollWanderers, parseWandererId, relocateWandererInto, wandererDayBucketFromMs,
    type Wanderer, type WandererVerb,
} from "../../../shared/wanderer-roster";
import { serverNow } from "./server-clock";

// ── Locked content: the NPC is on the road for everyone; the OFFER is gated ──
// Some archetypes hand the player straight into a system that may still be
// sealed for them: the gambler deals you into Shinobi Chronicle Showdown (locked
// until Scribe Ihara hands over the codex, `starterCardsClaimed`), the beast
// challenges your pet (needs one). The roster is a WORLD fact — every player in
// the sector sees the same cast, and the server re-rolls it to validate
// encounters — so these locks never change WHO appears. They gate the
// interaction instead: the NPC is visible, the verb is refused in-fiction
// (WorldMap startWandererCardDuel / startWandererPetDuel), and the server
// refuses the duel itself (api/card-clash/ai-start.ts chronicleUnlockedFor).

/** What this character can't be offered yet. Pure + tested; the single place
 *  that decides which verbs are content-locked. Used for INTERACTION gating
 *  only — never fed into the roster roll. */
export function lockedWandererVerbs(
    character: { starterCardsClaimed?: boolean; pets?: unknown[] } | null | undefined,
): WandererVerb[] {
    const locked: WandererVerb[] = [];
    // The card game is gated on the SCRIBE EVENT, not on owning cards — mirrors
    // api/card-clash/_starter-cards.ts `chronicleUnlocked` (only boolean true).
    if (character?.starterCardsClaimed !== true) locked.push("gamble");
    if (!character?.pets?.length) locked.push("petDuel");
    return locked;
}

/** Why this character can't take a wanderer's verb right now (null = allowed).
 *  The in-fiction line the dialog shows instead of the action. */
export function wandererVerbLockReason(
    character: { starterCardsClaimed?: boolean; pets?: unknown[] } | null | undefined,
    verb: WandererVerb,
): string | null {
    if (!lockedWandererVerbs(character).includes(verb)) return null;
    if (verb === "gamble") return "Come back when a scribe's put a codex in your pack — no sport in fleecing a man with nothing to play.";
    if (verb === "petDuel") return "You have no pet to send out — tame one first, and the beast will still be prowling this road.";
    return "You can't take this offer yet.";
}

/** Wanderers are a gameplay layer, not a cosmetic one: always on. (The old
 *  per-device `wanderers.v1 = "off"` kill switch let one player hide NPCs the
 *  rest of the sector could see; removed 2026-08.) Kept as a function so call
 *  sites compile unchanged. */
export function isWanderersEnabled(): boolean {
    return true;
}

// ── Per-NPC anti-spam cooldown ───────────────────────────────────────────────
// After a player uses a natural road wanderer (fight a bandit, take a road keeper's
// gift, duel a beast/gambler, or accept/claim from a non-legacy quest sage), that
// specific NPC goes on cooldown so it can't be farmed. Legacy Sage/emissary NPCs
// are synthetic and stay out of this path. Keyed by the wanderer's stable id ->
// expiry ms.
export const WANDERER_NPC_COOLDOWN_MS = 3 * 60 * 60 * 1000; // a few hours
// A SHORTER "back off" cooldown for when you FLEE/decline a bandit instead of
// fighting it. You took no reward, so it shouldn't vanish for the full anti-farm
// window — but it must stop hunting you, or the same bandit re-confronts you every
// single time you re-enter the sector until the 6h roster rolls over.
export const WANDERER_FLEE_COOLDOWN_MS = 30 * 60 * 1000; // half an hour
// The "no thanks" cooldown for the ROAMING QUEST-GIVER NPCs (the rift giver, the
// story road-event NPC, the Chronicle Scribe). These aren't part of the natural
// roster: they're synthesised per-player from whatever quest is next, so their
// presence gate keeps saying yes until the quest is dealt with — which meant
// declining one did nothing at all, and the same NPC was standing in the next
// sector you walked into. Turning a giver down now backs it off everywhere for a
// while, so "not now" is an answer the world respects. Longer than a bandit's
// flee back-off (you weren't running from anything) but well short of the
// anti-farm window (changing your mind shouldn't cost you the evening).
export const WANDERER_DECLINE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // two hours

export function isWandererOnCooldown(
    cooldowns: Record<string, number> | null | undefined,
    id: string,
    now: number,
): boolean {
    const exp = cooldowns?.[id];
    return typeof exp === "number" && exp > now;
}

/** A new cooldown map with `id` cooled until now + `ms` (defaults to the full
 *  anti-farm window; pass WANDERER_FLEE_COOLDOWN_MS for a short flee back-off),
 *  with already-expired entries pruned so the map stays tiny on the save. */
export function withWandererCooldown(
    cooldowns: Record<string, number> | null | undefined,
    id: string,
    now: number,
    ms: number = WANDERER_NPC_COOLDOWN_MS,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(cooldowns ?? {})) {
        if (typeof v === "number" && v > now) out[k] = v;
    }
    out[id] = now + ms;
    return out;
}

/** Roster window for a Date. Prefer `currentWandererDayBucket()` on the client
 *  so a skewed device never rolls a window the server refuses; this Date form
 *  stays for tests/back-compat. */
export function wandererDayBucket(now: Date): number {
    return wandererDayBucketFromMs(now.getTime());
}

/** The current roster window on the SERVER's clock. */
export function currentWandererDayBucket(): number {
    return wandererDayBucketFromMs(serverNow());
}

// ── Roaming quest-giver density ──────────────────────────────────────────────
// The "the road finds you" NPCs are synthesised per-player and each ran its own
// independent presence gate, so their odds STACKED: at 0.45/0.35/0.35 a sector
// averaged 1.15 giver standees on top of the natural roster, and any two of them
// could share a tile. These rates are the single place to tune that, and
// pickRoamingQuestGivers caps how many may stand in one sector at once.
//
// The Chronicle Scribe is NOT in this table and NOT subject to the cap: she gates
// a whole system rather than offering optional content, so she is always present
// once eligible and retires permanently on claim. See lib/chronicle-scribe.ts.
export const QUEST_GIVER_PRESENCE = {
    /** Main-story road beat (was 0.35). */
    road: 0.25,
    /** Repeatable Hollow Gate rift offer — the most common complaint, since the
     *  offered rift is fixed for a whole UTC day, so it was the SAME face in a
     *  third of every sector you entered all day (was 0.35). */
    rift: 0.2,
} as const;

/** How many rate-gated quest-giver standees may share one sector. One: they're
 *  meant to feel like a chance meeting on the road, not a job board. (The scribe
 *  stands outside this budget.) */
export const MAX_ROAMING_QUEST_GIVERS = 1;

/**
 * Which roaming quest-givers actually stand in the sector: drop any the player
 * has turned down (still inside WANDERER_DECLINE_COOLDOWN_MS) and keep at most
 * `max`, in the caller's PRIORITY order. Deterministic — each candidate is
 * already stable per (player, sector, window) and the cooldown map only moves
 * when the player interacts — so nothing flickers between polls.
 */
export function pickRoamingQuestGivers(
    candidates: Wanderer[],
    cooldowns: Record<string, number> | null | undefined,
    now: number,
    max: number = MAX_ROAMING_QUEST_GIVERS,
): Wanderer[] {
    const out: Wanderer[] = [];
    for (const w of candidates) {
        if (out.length >= max) break;
        if (isWandererOnCooldown(cooldowns, w.id, now)) continue;
        out.push(w);
    }
    return out;
}

// ── Relocation: a wanderer you've dealt with moves ON, not back ───────────────
// The per-NPC cooldown above hides a wanderer in its sector for a few hours — but
// the deterministic roster would otherwise drop it right back in the SAME sector
// the moment its cooldown lifts, so it "sits" there and can be re-farmed on a slow
// timer. Relocation closes that: interacting with a wanderer also records the
// sector it wanders off to (id → destination sector). Its home sector then stops
// listing it for the rest of the window, and it re-surfaces (once its cooldown has
// lifted) in the NEW sector instead — where dealing with it again nudges it on once
// more. We persist ONLY the destination (a number); the visiting wanderer is
// re-derived from its id, which already encodes its home sector + roster index, so
// nothing about the wanderer is duplicated onto the save. Merc/synthetic ids don't
// match the id shape and never relocate (they're server-driven). Keyed, like the
// cooldowns, by the wanderer's stable id. The whole map self-clears every 6h window
// (a stale-bucket prune), so it stays tiny.
/** Drop relocation entries from a stale window (the id's dayBucket no longer
 *  matches the current one) so the map clears itself every 6h and never grows
 *  without bound on the save. */
export function pruneWandererMoves(
    moves: Record<string, number> | null | undefined,
    currentDayBucket: number,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, dest] of Object.entries(moves ?? {})) {
        const parsed = parseWandererId(id);
        if (!parsed || parsed.dayBucket !== currentDayBucket) continue;
        if (typeof dest === "number" && dest >= 1) out[id] = dest;
    }
    return out;
}

/** True if the wanderer with this id has wandered off (has an active relocation),
 *  so its HOME sector should stop listing it. */
export function hasWandererRelocated(
    moves: Record<string, number> | null | undefined,
    id: string,
): boolean {
    return moves != null && typeof moves[id] === "number";
}

/** Wanderers that have wandered INTO `sector` from elsewhere and are ready to be
 *  found again (their cooldown has lifted). Re-derived from their ids against the
 *  current window; entries pointing at other sectors, still on cooldown, or from a
 *  stale window are skipped. */
export function wanderersVisitingSector(
    sector: number,
    dayBucket: number,
    moves: Record<string, number> | null | undefined,
    cooldowns: Record<string, number> | null | undefined,
    now: number,
): Wanderer[] {
    const out: Wanderer[] = [];
    for (const [id, dest] of Object.entries(moves ?? {})) {
        if (dest !== sector) continue;
        if (isWandererOnCooldown(cooldowns, id, now)) continue; // still on the road
        const parsed = parseWandererId(id);
        if (!parsed || parsed.dayBucket !== dayBucket) continue; // stale window
        // A visiting wanderer is RE-DERIVED from its id against the shared roll.
        const w = rollWanderers(parsed.sector, dayBucket)[parsed.index];
        if (!w) continue;
        out.push(relocateWandererInto(w, sector));
    }
    return out;
}

// ── Quests (sage wanderers) ──────────────────────────────────────────────────
// Display catalog mirrored by the server (api/sector/_wanderer-quest.ts owns the
// authoritative targets + reward). Each quest tracks a real character counter, and
// the label states honestly what that counter measures (no "these roads" promise
// the mechanic can't keep — any qualifying win/explore counts).
export type WandererQuestMetric = "totalAiKills" | "totalPetWins" | "cardClashWins" | "totalTilesExplored" | "relicSurveyCount";
export interface WandererQuestDef {
    id: string;
    label: string;
    metric: WandererQuestMetric;
    target: number;
    /** What the sage says when offering this errand, if it needs explaining. */
    brief?: string;
}
export const WANDERER_QUEST_CATALOG: WandererQuestDef[] = [
    { id: "wq-cull",       label: "Win 3 battles against any foe",        metric: "totalAiKills",       target: 3 },
    { id: "wq-purge",      label: "Win 6 battles against any foe",        metric: "totalAiKills",       target: 6 },
    { id: "wq-warpath",    label: "Defeat 10 road threats for the contract", metric: "totalAiKills",       target: 10 },
    { id: "wq-beasts",     label: "Win 2 pet duels in the colosseum",      metric: "totalPetWins",       target: 2 },
    { id: "wq-menagerie",  label: "Win 4 pet duels in the colosseum",      metric: "totalPetWins",       target: 4 },
    { id: "wq-cards",      label: "Win 2 Shinobi Chronicle Showdowns",   metric: "cardClashWins",      target: 2 },
    { id: "wq-highroller", label: "Win 4 Shinobi Chronicle Showdowns",   metric: "cardClashWins",      target: 4 },
    { id: "wq-scout",      label: "Scout 10 tiles across the sectors",    metric: "totalTilesExplored", target: 10 },
    { id: "wq-trailblaze", label: "Scout 25 tiles across the sectors",    metric: "totalTilesExplored", target: 25 },
    // The relic survey. Unlike every other errand this one tracks a SET (the
    // distinct countries walked since accepting), which is why its metric is a
    // length rather than a lifetime total — and why the label can promise
    // "each" without lying about what the counter measures.
    {
        id: "wq-relic-survey",
        label: "Walk one tile in each of the five countries",
        metric: "relicSurveyCount",
        target: 5,
        brief: "Relics are not forged and not sold — each country keeps its own, "
            + "and only an ancient chest out in the wild ever gives one up. Walk all "
            + "five and I will show you which land holds which. Their strength "
            + "answers in the field, never in a duel.",
    },
];

/**
 * The five countries the relic survey asks for, in the order the walkthrough
 * lists them, with the relic each one is known for. This is the ONLY place the
 * game tells a player that relics are biome-locked — without it the chase reads
 * as a pure lottery. Mirrors RELICS_BY_BIOME in api/world/_chest.ts.
 */
export const RELIC_SURVEY_STEPS: ReadonlyArray<{ biome: string; label: string; relic: string }> = [
    { biome: "forest",  label: "the deep forest",     relic: "Rootbound Effigy" },
    { biome: "snow",    label: "the snowfields",      relic: "Rimeglass Lens" },
    { biome: "volcano", label: "the burning ranges",  relic: "Ashfall Reliquary" },
    { biome: "shadow",  label: "the dark country",    relic: "Umbral Knot" },
    { biome: "central", label: "the old middle roads", relic: "Stormglass Pendulum, Gravewatch Fang, Drownstone Compass" },
];

/** Walkthrough state for the relic survey: which countries are done, which remain. */
export function relicSurveyWalkthrough(
    surveyed: readonly string[] | null | undefined,
): Array<{ biome: string; label: string; relic: string; done: boolean }> {
    const seen = new Set((surveyed ?? []).filter((b): b is string => typeof b === "string"));
    return RELIC_SURVEY_STEPS.map((step) => ({ ...step, done: seen.has(step.biome) }));
}

/** Quest objectives this character has no way to make progress on yet — the same
 *  content locks as lockedWandererVerbs, expressed as counters. Without this a
 *  sage could hand a pre-codex player "Win 2 Shinobi Chronicle Showdowns", which
 *  is unwinnable while the Card Hall is sealed, and it occupies their one quest
 *  slot. (The server owns the target + reward per quest id either way; this only
 *  decides what gets OFFERED.) */
export function lockedQuestMetrics(
    character: { starterCardsClaimed?: boolean; pets?: unknown[] } | null | undefined,
): WandererQuestMetric[] {
    const locked: WandererQuestMetric[] = [];
    if (character?.starterCardsClaimed !== true) locked.push("cardClashWins");
    if (!character?.pets?.length) locked.push("totalPetWins");
    return locked;
}

/** The (stable) quest a given sage offers — deterministic from its id, drawn only
 *  from objectives the player can actually make progress on. */
export function questForWanderer(w: Wanderer, lockedMetrics?: readonly WandererQuestMetric[]): WandererQuestDef {
    const pool = lockedMetrics?.length
        ? WANDERER_QUEST_CATALOG.filter((q) => !lockedMetrics.includes(q.metric))
        : WANDERER_QUEST_CATALOG;
    const catalog = pool.length ? pool : WANDERER_QUEST_CATALOG;
    let h = 0;
    for (let i = 0; i < w.id.length; i++) h = (Math.imul(h, 31) + w.id.charCodeAt(i)) >>> 0;
    return catalog[h % catalog.length];
}

/** Which character counter an active quest tracks (for client-side progress). */
export function questMetricForId(id: string): WandererQuestMetric {
    return WANDERER_QUEST_CATALOG.find((q) => q.id === id)?.metric ?? "totalAiKills";
}

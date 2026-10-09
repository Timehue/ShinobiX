import type { TowerActor, TowerSession } from '../towers/_tower-session.js';
import type { PvpFighter } from '../pvp/session.js';
import { isSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';

/*
 * Step 4 — the outcome of a sealed AI fight, read from the SESSION.
 *
 * Before this, `report-ai-fight` paid on the client's say-so: calling the
 * endpoint at all WAS the claim that the player had won. The reward amounts were
 * already sealed (the token carries baseXp/baseRyo), so the exposure was not the
 * size of the payout — it was that a client could claim a win it never earned,
 * and that losing cost nothing because no defeat was ever reported.
 *
 * Both halves close here. The session is server-owned and server-resolved, so it
 * is the authority on BOTH questions: did the player win, and what HP did they
 * walk away with.
 *
 * This matters as much for difficulty as for anti-cheat. Sealed settlement must
 * persist surviving HP and hospitalize a knocked-out player, so failed hunts or
 * raids cannot become free retries.
 */

/** Matches the hospital stay every other defeat path applies (api/player/heal.ts). */
export const AI_FIGHT_HOSPITAL_DURATION_MS = 60_000;

export type AiFightOutcome = 'win' | 'loss' | 'draw' | 'forfeit' | 'unknown';
export type AiFightSession = TowerSession | SoloPveSession;
export type AiFightPlayerCombatant = TowerActor | PvpFighter;

function num(value: unknown): number {
    return Math.max(0, Math.floor(Number(value) || 0));
}

/**
 * The human fighter in a solo AI-fight session. These sessions carry exactly one
 * non-AI squad actor (a summoned companion is `ai: true`), so side + ai is an
 * unambiguous match and does not depend on the owner-slug spelling.
 */
export function aiFightPlayerActor(session: SoloPveSession): PvpFighter;
export function aiFightPlayerActor(session: TowerSession): TowerActor | undefined;
export function aiFightPlayerActor(session: null | undefined): undefined;
export function aiFightPlayerActor(session: AiFightSession | null | undefined): AiFightPlayerCombatant | undefined;
export function aiFightPlayerActor(session: AiFightSession | null | undefined): AiFightPlayerCombatant | undefined {
    if (isSoloPveSession(session)) return session.player;
    return session?.actors?.find((actor) => actor.side === 'squad' && actor.ai === false);
}

/**
 * The fighter that IS `playerName` in this session — the body a physical
 * outcome may be written to.
 *
 * `aiFightPlayerActor` answers "the human in a SOLO session", which is right for
 * the sealed-token path (one owner, one human). It is the wrong question for a
 * shared Tower session: with two humans in the squad it returned the FIRST one
 * for every caller, so a teammate's settlement carried the host's HP onto the
 * teammate's save. This resolves by canonical owner slug (case-insensitive),
 * preferring the live human actor over an AFK-flagged one (an AFK human is
 * marked `ai: true` but keeps its `ownerSlug`), and never a companion
 * (`ownerSlug: null`). `undefined` means this player has no body in the run
 * and settlement must refuse rather than guess.
 */
export function aiFightParticipantActor(
    session: AiFightSession | null | undefined,
    playerName: string,
): AiFightPlayerCombatant | undefined {
    if (!session || !playerName) return undefined;
    const slug = playerName.toLowerCase();
    if (isSoloPveSession(session)) {
        return session.ownerSlug.toLowerCase() === slug ? session.player : undefined;
    }
    const owned = session.actors.filter((actor) => actor.side === 'squad' && (actor.ownerSlug ?? '').toLowerCase() === slug);
    return owned.find((actor) => actor.ai === false) ?? owned[0];
}

/** Consumables spent by the authoritative human fighter. Settlement applies
 * this inside the same save mutation as the outcome and reward receipt. */
export function aiFightPlayerItemsUsed(session: AiFightSession | null | undefined): Record<string, number> {
    if (!session) return {};
    if (isSoloPveSession(session)) return { ...session.itemsUsed };
    return { ...(aiFightPlayerActor(session)?.itemsUsed ?? {}) };
}

/**
 * Whether `playerName` actually fought in this session.
 *
 * Load-bearing for /api/pve/fight-outcome, where the runId is CLIENT-supplied
 * (unlike the AI-fight path, whose runId comes from a sealed token stored under
 * the caller's own name). Without this check a player could hand in a stranger's
 * runId and apply that session's outcome to their own save — and on a WINNING
 * session, "apply the surviving HP" is a free heal.
 */
export function isPveFightMember(session: AiFightSession | null | undefined, playerName: string): boolean {
    if (!session || !playerName) return false;
    if (isSoloPveSession(session)) return session.ownerSlug.toLowerCase() === playerName.toLowerCase();
    return session.actors.some(a => a.side === 'squad' && a.ownerSlug === playerName);
}

/**
 * Resolve what actually happened.
 *
 * A session that is still `active` is a FORFEIT, not a no-op: the fight screen's
 * own exit is worded "you'll forfeit the run", and without this a player losing
 * a fight could simply close it and take no damage at all — a free retry, every
 * time, which is strictly better than winning carefully.
 *
 * A MISSING session resolves to `unknown` and must neither pay nor punish. The
 * store has a TTL, and a settle that arrives after it lapsed is far more likely
 * to be a slow network than a cheat; failing closed on the reward while refusing
 * to hospitalize is the only side that cannot hurt an honest player.
 *
 * No ownership check is needed here: the runId is read from the SEALED TOKEN,
 * which is stored under the caller's own name, so it can never address another
 * player's session. Nothing in the request body reaches this.
 */
export function resolveAiFightOutcome(session: AiFightSession | null | undefined): AiFightOutcome {
    if (!session) return 'unknown';
    if (session.status !== 'done') return 'forfeit';
    if (isSoloPveSession(session)) {
        if (session.winner === 'player') return 'win';
        if (session.winner === 'draw') return 'draw';
        return 'loss';
    }
    if (session.winner === 'squad') return 'win';
    if (session.winner === 'draw') return 'draw';
    return 'loss';
}

/**
 * Whether this settle should pay the ordinary sealed reward purse.
 *
 * Only a WIN pays, and a plain practice bout never does — no ryo, currency,
 * items or kill credit. Dungeon Warden wins use their own run settlement and
 * still receive capped combat stat growth through report-ai-fight.
 *
 * Practice still SETTLES, though — its token is consumed and any consumable it
 * burned stays spent — but as a spar it writes no physical consequence (see
 * `sessionIsSpar`), which is why this is a separate question from "did the
 * fight resolve".
 */
export function aiFightPaysReward(outcome: AiFightOutcome, battleKind: string | undefined): boolean {
    // Dungeon Warden combat proves the later Dungeon settlement; paying the
    // ordinary AI purse here would double-pay the same run.
    return outcome === 'win' && battleKind !== 'practice' && battleKind !== 'dungeon';
}

/** The Academy spar's sealed session (api/story/spar-start.ts). */
const ACADEMY_SPAR_ENCOUNTER_KIND = 'academy-spar';

/**
 * Whether this run's own SETTLEMENT already owns the player's HP on a win, so
 * the outcome report must leave it alone.
 *
 * One mode does: the Academy spar grants a scripted post-spar HP (`maxHp - 25`
 * in applyAcademySparSettlement) rather than the HP the fight left, and the
 * story client fires both writes the moment the fight resolves
 * (MissionArenaFight runs `settleFn` and `outcomeFn` together), so without
 * this the ending HP depended on which mutation got there first.
 *
 * A story boss used to be the second. Its settlement grants the HP the fight
 * left PLUS 25, and a report landing after it took the +25 back. It now writes
 * the fight's HP at most once against this report's receipt and adds the 25 as
 * the reward it is (api/story/settle.ts), so the two reach the same HP in
 * either order, and a won boss can be settled before another fight is sealed
 * (api/pve/_held-fights.ts).
 *
 * Deliberately narrow, and keyed off the SESSION's own encounter rather than
 * anything the caller says — a client cannot opt its fight out of paying for
 * itself. A LOST spar is untouched by this and still reports normally (its
 * settlement refuses a loss). As a spar (`sessionIsSpar`) a lost spar leaves
 * the beginner's HP as it was, so they can step straight back onto the mat
 * instead of into a hospital bed.
 */
export function settlementOwnsHpOnWin(session: AiFightSession | null | undefined): boolean {
    if (isSoloPveSession(session)) return session.encounter.kind === ACADEMY_SPAR_ENCOUNTER_KIND;
    return session?.towerId === ACADEMY_SPAR_ENCOUNTER_KIND;
}

/**
 * Did this session seat the player at a FULL HP pool instead of the HP their
 * save held? Every Tower-engine run does: buildTowerEncounter seals each squad
 * actor at full vitals (api/towers/_encounter.ts `squadActor`), and so the
 * Celestial Tower, the Endless Spire, Clan Boss assaults and World Crisis
 * fights all start a wounded player at full health. What such a run leaves is
 * "what is left of a pool the run handed you", unrelated to what the player
 * held, so writing it back can only ever COST HP (see the HP note in
 * applyAiFightOutcomeToCharacter).
 *
 * The Sunscar caravan ambush is the one Tower run re-seeded from the save
 * (api/festival/_caravan-combat.ts), so its remaining HP is a real cost.
 * Solo-PvE sessions are not Tower runs; buildSoloPveAiEncounter seeds HP from
 * the save.
 */
export function sessionSeedsFullHp(session: AiFightSession | null | undefined): boolean {
    if (!session || isSoloPveSession(session)) return false;
    return !session.caravanAmbush;
}

/**
 * The vitals the player's SAVE held when a fight was sealed from it. HP is
 * sealed for every fight seeded from the save; chakra and stamina only for a
 * CONTINUOUS (open-world) one, the only kind that carries them back.
 */
export type SeededVitals = { hp?: number; chakra?: number; stamina?: number };
export type SeededVital = keyof SeededVitals;

const VITAL_POOL: Record<SeededVital, 'maxHp' | 'maxChakra' | 'maxStamina'> = {
    hp: 'maxHp',
    chakra: 'maxChakra',
    stamina: 'maxStamina',
};

/**
 * What this session sealed of the save it was seeded from: every Solo-PvE
 * encounter built by buildSoloPveAiEncounter, and the Sunscar caravan ambush
 * (api/festival/_caravan-combat.ts). `undefined` for a session sealed before
 * the field existed, and for a run that seats a full pool instead
 * (`sessionSeedsFullHp`).
 *
 * It is what makes a LATE first settlement honest. Settlement used to write the
 * fight's surviving HP as an absolute value, which is right only while the save
 * still holds what the fight was seeded from. Finish a fight at high HP, keep
 * its report back, lose HP in another mode and settle that, then report the
 * first fight: its write set HP back up to its own end value, a free heal. The
 * write now subtracts whatever the save has lost since (`vitalLostSinceSeal`),
 * and a continuous fight's chakra and stamina are settled the same way.
 */
export function sessionSeededVitals(session: AiFightSession | null | undefined): SeededVitals | undefined {
    if (!session) return undefined;
    const sealed: unknown = isSoloPveSession(session) ? session.seededVitals : session.caravanAmbush?.seededVitals;
    if (!sealed || typeof sealed !== 'object') return undefined;
    const vitals: SeededVitals = {};
    for (const field of ['hp', 'chakra', 'stamina'] as const) {
        const value = (sealed as Record<string, unknown>)[field];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) vitals[field] = Math.floor(value);
    }
    return Object.keys(vitals).length > 0 ? vitals : undefined;
}

/** A vital as settlement reads it from the save. One with no readable value
 *  counts as full, as it did when the fighter was seeded (`finite(value, max)`). */
function heldVital(character: Record<string, unknown>, field: SeededVital, max: number): number {
    const stored = character[field];
    return typeof stored === 'number' && Number.isFinite(stored)
        ? Math.max(0, Math.min(max, Math.floor(stored)))
        : max;
}

/**
 * How much of one vital the save has lost since a fight was sealed from it
 * (`sessionSeededVitals`), given what the save holds NOW. A settlement
 * subtracts it from what the fight left. 0 when that vital was not sealed. Pure.
 *
 * Only a LOSS since the seal counts. What the save gained since is never
 * credited: idle recovery keeps running on the save while a Solo-PvE fight is
 * fought (nothing battle-locks it), and the absolute write has always replaced
 * that, so crediting it would make every fight a little cheaper. A settlement
 * built on this is therefore never above the old value, and equal to it
 * whenever the save has lost nothing since the seal, which is every prompt
 * settlement.
 *
 * ⚠ Not idempotent: written twice, a fight would be charged its own cost a
 * second time as "lost since". Every writer applies it at most once against the
 * shared pve-outcome receipt (api/pve/_fight-outcome-settlement.ts), and
 * api/pve/_seeded-body-writers.test.ts fails on a writer that does not.
 *
 * A survivor keeps the floor of 1 HP after the subtraction. The hospital
 * follows the fight's own authoritative 0 HP, not a sum: what the player lost
 * elsewhere cannot knock them out of a fight they walked away from.
 */
export function vitalLostSinceSeal(character: Record<string, unknown>, field: SeededVital, seeded: SeededVitals | undefined): number {
    const seed = seeded?.[field];
    if (seed === undefined) return 0;
    const max = Math.max(field === 'hp' ? 1 : 0, num(character[VITAL_POOL[field]]));
    // Against the pool as it stands now, so a maximum that shrank since (gear
    // taken off) is not mistaken for a loss.
    return Math.max(0, Math.min(seed, max) - heldVital(character, field, max));
}

/**
 * Is this fight a SPAR — a consensual practice bout rather than a real fight?
 *
 * Owner rule (2026-09-24): "when your HP hits 0 you go to the hospital unless
 * it's a spar or ranked match". Ranked and player-vs-player spars already fight
 * on a fresh pool and write nothing back (api/pvp/_vitals-settlement.ts). This
 * is the same rule for the AI side: a practice bout (Arena spar, Dojo Circuit,
 * the Logbook exams, the non-paying creator-event preview) and the Academy
 * spar. A spar writes NO physical consequence at all — neither the hospital nor
 * the damage — so losing one never costs less than winning it.
 *
 * Read from the SEALED session: the Academy spar by its encounter kind, a
 * practice bout by the `spar` flag ai-fight-start stamps on its encounter. A
 * caller cannot opt a real fight into it.
 */
export function sessionIsSpar(session: AiFightSession | null | undefined): boolean {
    if (isSoloPveSession(session)) {
        return session.encounter.kind === ACADEMY_SPAR_ENCOUNTER_KIND
            || session.encounter.metadata?.spar === true;
    }
    return session?.towerId === ACADEMY_SPAR_ENCOUNTER_KIND;
}

/**
 * Write the sealed fight's physical consequence onto the character: surviving
 * HP on any resolved outcome, and a hospital stay when the player was knocked
 * out. All Solo PvE settlement consumers share this boundary.
 */
/**
 * Did this session seed the player from their CURRENT vitals (an open-world
 * encounter) rather than a fresh full pool? Stamped on the encounter at creation
 * by api/solo-pve/_ai-encounter.ts, so it survives storage and a settle can ask
 * the session itself rather than re-deriving it from a battle kind.
 */
export function sessionUsesContinuousVitals(session: unknown): boolean {
    const encounter = (session as { encounter?: { metadata?: Record<string, unknown> } } | null)?.encounter;
    return encounter?.metadata?.continuousVitals === true;
}

export function applyAiFightOutcomeToCharacter(
    character: Record<string, unknown>,
    outcome: AiFightOutcome,
    playerActor: AiFightPlayerCombatant | undefined,
    now: number,
    /** True only for an OPEN-WORLD encounter seeded from the player's current
     *  vitals. Defaults false so every existing caller keeps HP-only behaviour. */
    continuousVitals = false,
    /** True for a spar (`sessionIsSpar`): no physical consequence is written. */
    spar = false,
    /** True when the run seated the player at a FULL HP pool
     *  (`sessionSeedsFullHp`): the surviving HP may lower the save's, never raise it. */
    fullHpSeed = false,
    /** What the save held when the fight was seeded from it (`sessionSeededVitals`).
     *  Whatever the save has lost since is charged on top of what the fight left. */
    seeded?: SeededVitals,
): Record<string, unknown> {
    if (outcome === 'unknown') return character;
    // A spar is practice. Win, lose, draw or walk away, the player leaves with
    // the HP they brought and never lands in the hospital — the same contract
    // ranked and PvP spars already keep. Chakra and stamina are untouched too,
    // since no spar is a continuous encounter.
    if (spar) return character;
    // No actor to read means no evidence of what the fight cost. Guessing would
    // be worse than doing nothing. Mounted AI-fight settlement rejects this
    // shape; the guard remains for legacy/corrupt callers of this pure helper.
    if (!playerActor) return character;

    // ⚠ The hospital keys off the player being DOWN, not off `winner !== squad`.
    // A run can end with the player alive and standing: the weekly boss is
    // explicitly won by OUTLASTING the round budget, and a mission or story run
    // that times out is a failure the player walked away from. Hospitalizing on
    // "not a squad win" would send someone at full HP to a hospital bed for
    // surviving. Hospital admission follows authoritative zero HP, not a generic
    // non-win outcome.
    // Chakra and stamina come back ONLY from a CONTINUOUS encounter — an
    // open-world fight, which seeded the actor from the vitals the player
    // actually had (api/solo-pve/_ai-encounter.ts). There, the actor's end value
    // is genuinely what the fight cost, and carrying it back is the owner's
    // 2026-09-08 ruling: you are put back in your spot with the HP, chakra and
    // stamina you finished with.
    //
    // ⛔ NEVER carry them out of a FRESH-START encounter. A dive, a Spire wave, a
    // story boss, an Academy spar and the weekly boss all seed the actor at the
    // FULL pool, so its remainder is "what is left of a pool the fight handed
    // you", unrelated to what the player held. Writing that back is a FAUCET:
    // enter at 10% chakra, fight on a free full bar, finish at 60%, bank the 60%.
    // That was shipped on 2026-09-08 and reverted the same day.
    //
    // Clamped DECREASE-ONLY as a second line of defence, so even a mislabelled
    // encounter can only ever cost a player vitals, never mint them.
    //
    // HP is carried from a resolved fight built by buildSoloPveAiEncounter,
    // which seeds it from the save's current HP: what the fight left is what it
    // cost. A Tower run does NOT. It seats the squad at full HP (`sessionSeedsFullHp`),
    // so carrying its remainder back turned "enter wounded, walk out of a run"
    // into a free heal: the Tower lapse settles every member this way
    // (api/towers/_lapse.ts), and /api/pve/fight-outcome reads Tower runs too.
    // For those runs HP is decrease-only, like chakra and stamina above.
    //
    // "What the fight left is what it cost" holds only while the save still
    // holds what the fight was seeded from. A settlement can land late (a held
    // report, the lapse reconciler), after the player lost HP, chakra or stamina
    // elsewhere, so a fight seeded from the save also charges that loss
    // (`seeded`, see vitalLostSinceSeal). Without it a held report waived the
    // fight's own chakra and stamina cost whenever the bar had fallen below
    // what the fight left in the meantime.
    const carry = (field: 'chakra' | 'stamina'): number | undefined => {
        if (!continuousVitals) return undefined;
        const actorValue = playerActor[field];
        if (typeof actorValue !== 'number' || !Number.isFinite(actorValue)) return undefined;
        return Math.max(0, Math.min(num(character[field]), Math.floor(actorValue) - vitalLostSinceSeal(character, field, seeded)));
    };
    const spent: Record<string, number> = {};
    const carriedChakra = carry('chakra');
    if (carriedChakra !== undefined) spent.chakra = carriedChakra;
    const carriedStamina = carry('stamina');
    if (carriedStamina !== undefined) spent.stamina = carriedStamina;

    if (num(playerActor.hp) <= 0) {
        return {
            ...character,
            ...spent,
            hp: 0,
            hospitalized: true,
            hospitalizedAt: now,
            hospitalizedUntil: now + AI_FIGHT_HOSPITAL_DURATION_MS,
        };
    }

    // Survived — win, draw, timeout, or walked out mid-fight. Carry the HP back.
    // This is what makes a forfeit cost something without over-punishing it: you
    // leave at the HP you left with, so bailing out of a fight you are losing
    // still means healing before the next one.
    //
    // Clamped to the SAVE's own maxHp so a stale session (sealed before a level
    // changed the pool) can never set HP above the real ceiling.
    const maxHp = Math.max(1, num(character.maxHp));
    // A fight seeded from the save also charges what the save has lost since it
    // was sealed (vitalLostSinceSeal; nothing for a session with no seed), so a
    // late settlement cannot write HP back up over damage taken elsewhere.
    const surviving = Math.max(1, Math.min(maxHp, num(playerActor.hp) - vitalLostSinceSeal(character, 'hp', seeded)));
    if (!fullHpSeed) return { ...character, ...spent, hp: surviving };
    // A save with no readable HP is treated as full, which leaves the cost intact.
    const storedHp = character.hp;
    const held = typeof storedHp === 'number' && Number.isFinite(storedHp)
        ? Math.max(0, Math.min(maxHp, Math.floor(storedHp)))
        : maxHp;
    return { ...character, ...spent, hp: Math.min(held, surviving) };
}

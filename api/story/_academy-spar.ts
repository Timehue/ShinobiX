import { randomUUID } from 'node:crypto';
import type { AdminCombatContent } from '../_admin-content.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { ACADEMY_SPAR_OPPONENT_ID } from './_settle.js';
import {
    STORY_COMBAT_SESSION_TTL_MS,
    validateSealedStoryRun,
    type StoryCombatBinding,
    type StoryCombatValidation,
} from './_authoritative-story-combat.js';

/*
 * Server-owned Academy sparring dummy — step 5 of the AI-fight migration
 * (docs/runbooks/combat-mode-migration.md), first subsystem.
 *
 * The onboarding spar was one of the fights the CLIENT invented at launch: it
 * built a level-1 dummy and resolved the whole battle locally. The opponent is
 * now server-generated here and only a terminal solo-PvE session can settle it.
 *
 * The dummy is CONSTANT, which is why it was the cheapest of the six to move:
 * there is no run state, no scaling and no authored content to read. The
 * constants below mirror `shinobij.client/src/lib/academy-spar.ts`
 * argument-for-argument, and `scripts/academy-spar-parity.test.ts` fails if the
 * two drift — a heavier server dummy would silently break the tutorial's
 * guaranteed first win.
 *
 * ⚠ The stat sheet is deliberately NOT a scaled-down mission template. The
 * client's dummy is `aiStatsForLevel(1, jutsus)` with 50 HP and no armor; a
 * generic level-1 enemy template (240 HP, 180 offense) would be a different,
 * much longer fight for a brand-new player.
 */

/** Stable, server-resolvable opponent id — the whole point of the migration.
 *  Declared in
 *  ./_settle.ts (the graph leaf) and re-exported here, which is where callers
 *  expect it. */
export { ACADEMY_SPAR_OPPONENT_ID };

export const ACADEMY_SPAR_LEVEL = 1;
export const ACADEMY_SPAR_HP = 50;
export const ACADEMY_SPAR_NAME = 'Academy Training Dummy';

/** The first two jutsu of the client's `balanced` loadout — mirrored ids, not a
 *  re-derivation. Resolved through the shared server catalog so the dummy casts
 *  the same objects a player would (see api/_ai-opponent-loadout.ts). */
export const ACADEMY_SPAR_JUTSU_IDS: string[] = ['starter-gen-lightning-2', 'starter-nin-fire-2'];

/** Level-1 chakra/stamina pools (`maxChakraForLevel(1)` under combatResourcesV2).
 *  Not 100 — the v2 pools start at 1,000. */
export const ACADEMY_SPAR_POOL = 1_000;

/**
 * The level-1 stat sheet, verbatim from the client's
 * `aiStatsForLevel(1, jutsus)` for this two-jutsu loadout (its primary type
 * resolves to Ninjutsu, which is what lifts ninjutsuOffense and the mental
 * generals a point above the rest).
 *
 * ⚠ These are single digits into the low teens, roughly a hundredth of a
 * generic level-1 mission enemy's sheet. That gap IS the tutorial: the dummy
 * must fall in a few hits. Do not "normalize" it toward the mission curve.
 */
export const ACADEMY_SPAR_STATS: Record<string, number> = {
    strength: 12,
    speed: 12,
    intelligence: 13,
    willpower: 13,
    bukijutsuOffense: 12,
    bukijutsuDefense: 11,
    taijutsuOffense: 11,
    taijutsuDefense: 11,
    genjutsuOffense: 11,
    genjutsuDefense: 11,
    ninjutsuOffense: 12,
    ninjutsuDefense: 11,
};

export type AcademySparEligibility =
    | { ok: true }
    | { ok: false; status: number; error: string };

/**
 * Gate the START on exactly what the SETTLE will demand
 * (`applyAcademySparSettlement` in ./_settle.ts). Without this a player past
 * onboarding could open a sealed spar session that could never pay out — a
 * fight the server would then charge them for on the outcome report.
 */
export function academySparEligibility(character: Record<string, unknown>): AcademySparEligibility {
    if (character.academySparClaimed === true) {
        return { ok: false, status: 409, error: 'Academy spar reward was already claimed.' };
    }
    const onboardingStep = String(character.onboardingStep ?? '');
    if (onboardingStep !== 'academySpar' && onboardingStep !== 'spar') {
        return { ok: false, status: 409, error: 'Academy spar is not the current onboarding step.' };
    }
    return { ok: true };
}

/** Build the sealed dummy. `admin` is passed through to the jutsu resolver for
 *  the same reason every other sealed fight passes it: admin-authored overrides
 *  of a starter jutsu must reach the AI too. */
export function academySparEnemyTemplate(admin?: AdminCombatContent | null) {
    return {
        id: ACADEMY_SPAR_OPPONENT_ID,
        name: ACADEMY_SPAR_NAME,
        // Mirrors the client's aiPrimaryJutsuType for this loadout.
        specialty: 'Ninjutsu',
        level: ACADEMY_SPAR_LEVEL,
        hp: ACADEMY_SPAR_HP,
        stats: { ...ACADEMY_SPAR_STATS },
        visual: ACADEMY_SPAR_OPPONENT_ID,
        // `boss: true` is what makes the engine treat it as the defeat-boss
        // objective's target, not a difficulty statement — every solo encounter
        // template sets it, including the level-1 mission drill.
        boss: true,
        armorRawDR: 0,
        maxChakra: ACADEMY_SPAR_POOL,
        maxStamina: ACADEMY_SPAR_POOL,
        jutsu: resolveAiProfileJutsu(ACADEMY_SPAR_JUTSU_IDS, admin ?? null),
    };
}

export function academySparRunId(): string {
    return `spar-${randomUUID().replace(/-/g, '')}`;
}

/**
 * A spar binding reuses the story-combat binding record (same key, same TTL,
 * same settle plumbing) with `kind: 'spar'` and the milestone fields zeroed —
 * the spar has no chapter, no village catalog row and no reward table entry.
 * `validateCompletedStoryCombatSession` refuses a spar binding outright, so
 * this can never be redirected into a milestone payout.
 */
export function createAcademySparBinding(params: {
    runId: string;
    playerName: string;
    now?: number;
}): StoryCombatBinding {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        kind: 'spar',
        sessionId: params.runId,
        runId: params.runId,
        playerName: params.playerName,
        village: '',
        progressIndex: -1,
        opponentId: ACADEMY_SPAR_OPPONENT_ID,
        rewardFingerprint: '',
        createdAt: now,
        expiresAt: now + STORY_COMBAT_SESSION_TTL_MS,
        status: 'active',
    };
}

/**
 * Settle-time validation. The run checks are the shared ones; the spar's own
 * gate is that the save is STILL owed the tutorial reward — re-checked here
 * rather than trusted from start time, so a session opened before the reward
 * was claimed some other way cannot pay it twice.
 */
export function validateCompletedAcademySparSession(params: {
    binding: StoryCombatBinding | null | undefined;
    session: SoloPveSession | null | undefined;
    playerName: string;
    character: Record<string, unknown>;
    now?: number;
}): StoryCombatValidation {
    if (params.binding?.kind !== 'spar') return { ok: false, reason: 'invalid-binding' };
    if (params.binding.opponentId !== ACADEMY_SPAR_OPPONENT_ID) return { ok: false, reason: 'invalid-binding' };
    const shared = validateSealedStoryRun(params);
    if (!shared.ok) return shared;
    if (!academySparEligibility(params.character).ok) return { ok: false, reason: 'already-settled' };
    return shared;
}

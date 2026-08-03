/*
 * Generic AI fight → sealed, server-resolved encounter.
 *
 * Step 2 of the AI-fight migration (docs/runbooks/combat-mode-migration.md).
 * Generic AI fights are the last combat mode where the CLIENT decides it won;
 * this module builds the server-side encounter that will replace that, on the
 * SAME proven machinery every other authoritative PvE mode already uses (the
 * tower engine, via buildAuthoritativeSoloEncounter).
 *
 * It is deliberately split from the handler so the whole build is testable
 * without HTTP: `loadAiFightProfile` is the one async step (catalog lookup +
 * the admin-authored `shared:ai-profiles` fallback) and
 * `buildAiFightEncounter` is a synchronous function of its inputs.
 *
 * ── Opponent scaling ───────────────────────────────────────────────────────
 * Absent a `scaling` argument the opponent is built at its AUTHORED level. The
 * client re-levels built-in AIs per entry point (`relevelBuiltinAi`: a combat
 * mission aligns the foe to the player, hunts scale by sector, rifts rebase to
 * player+15), so a faithful server fight needs the same rebuild — that is what
 * `scaling` does, through the parity-tested curves in api/_ai-level-curves.ts.
 *
 * `scaling` must be derived from SERVER-KNOWN state (the save's level, the
 * mission/contract definition), never from the request body. A client-chosen
 * opponent level is a client-chosen difficulty, which is the exact authority
 * this migration exists to remove. `ai-fight-start` deliberately does not read
 * `opponentLevel`; wiring each entry point's rule is the rest of step 3.
 *
 * Terrain is likewise neutral: the floor uses the 'central' biome rather than
 * the client's sector terrain (a biome grants the +10% school buff), so no
 * unearned terrain advantage is sealed in.
 */
import type { TowerFloor } from '../towers/_floor-catalog.js';
import type { TowerSession } from '../towers/_tower-session.js';
import { sealCompanionFromSave } from '../towers/_companion.js';
import { kv } from '../_storage.js';
import { safeLogValue } from '../_safe-log.js';
import {
    aiOpponentEnemyTemplate,
    buildAuthoritativeSoloEncounter,
    dynamicBossFloor,
} from '../_authoritative-pve.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import type { AdminCombatContent } from '../_admin-content.js';

/** Floor ids for AI fights. Kept clear of the combat-mission band (9_100+) and
 *  the real tower catalog so a sealed AI fight can never collide with a floor. */
export const AI_FIGHT_FLOOR_ID = 9_300;

/** Advisory only for a 'defeat-boss' objective (the engine enforces roundBudget
 *  for 'survive' floors), matched to combat-start.ts for consistency. */
export const AI_FIGHT_ROUND_BUDGET = 24;

export type AiFightProfile = Record<string, unknown> & { id: string };

/**
 * Resolve an opponent id to a profile: the generated built-in mirror first
 * (api/_ai-profile-catalog.ts, parity-tested against the client's builtinAis),
 * then the admin-authored `shared:ai-profiles` list. Returns null for an
 * unknown id — the caller must NOT fabricate an opponent, or the sealed fight
 * would not be the one the player is looking at.
 */
export async function loadAiFightProfile(opponentId: unknown): Promise<AiFightProfile | null> {
    const id = typeof opponentId === 'string' ? opponentId.trim().slice(0, 96) : '';
    if (!id || !/^[A-Za-z0-9:_-]+$/.test(id)) return null;
    const builtin = builtinAiProfile(id);
    if (builtin) return builtin as unknown as AiFightProfile;
    try {
        const authored = await kv.get<Array<Record<string, unknown>>>('shared:ai-profiles');
        if (!Array.isArray(authored)) return null;
        const match = authored.find((p) => p && typeof p === 'object' && p.id === id);
        return match ? (match as AiFightProfile) : null;
    } catch (err) {
        // An unreachable admin list must not fail the fight start — the caller
        // falls back to the token-only path, exactly as if the id were unknown.
        console.error('[ai-fight-encounter] shared:ai-profiles read failed', safeLogValue(err));
        return null;
    }
}

/** The sealed battlefield for an AI fight. Neutral biome (see the scope note). */
export function aiFightFloor(profile: AiFightProfile): TowerFloor {
    return dynamicBossFloor({
        id: AI_FIGHT_FLOOR_ID,
        name: typeof profile.name === 'string' ? profile.name.slice(0, 80) : profile.id,
        bossAiId: profile.id,
        objective: 'defeat-boss',
        roundBudget: AI_FIGHT_ROUND_BUDGET,
        biome: 'central',
    });
}

/**
 * How an entry point rebuilds the opponent for this fight. Mirrors the client's
 * `relevelBuiltinAi(base, level, statBonus, hpFloor)` argument-for-argument.
 * Derive it from server-known state only — see the scaling note above.
 */
export type AiFightScaling = {
    level: number;
    /** Rank/tier stat bonus added to every stat (combat missions use 0-90). */
    statBonus?: number;
    /** Minimum HP, so an early-game foe is not one-tapped. No-op above the curve. */
    hpFloor?: number;
};

/**
 * Build the sealed encounter. Mirrors api/missions/combat-start.ts, with the
 * opponent coming from an AI profile instead of a mission definition.
 *
 * With `scaling`, the profile is REBUILT at the target level through the
 * parity-tested curves — stats, HP, pools and armor all move together. Stamping
 * a bare level would produce a level-60 opponent still carrying level-18 stats,
 * which is a weaker fight than the client shows, not a faithful one.
 */
export function buildAiFightEncounter(params: {
    playerName: string;
    save: Record<string, unknown>;
    profile: AiFightProfile;
    runId: string;
    seed: number;
    now: number;
    admin?: AdminCombatContent | null;
    hostLoadout?: Record<string, unknown>;
    scaling?: AiFightScaling;
}): TowerSession {
    const admin = params.admin ?? null;
    // Resolve the kit FIRST: the discipline mix picks the archetype weights the
    // re-level distributes stats by, so this has to happen before scaling.
    const loadout = resolveAiProfileJutsu(params.profile.jutsuIds, admin);
    const profile = params.scaling && Number.isFinite(params.scaling.level)
        ? relevelAiProfile(
            params.profile as unknown as RelevelableProfile,
            params.scaling.level,
            params.scaling.statBonus ?? 0,
            params.scaling.hpFloor ?? 0,
            loadout,
        ) as unknown as AiFightProfile
        : params.profile;
    const bossTemplate = aiOpponentEnemyTemplate(profile, loadout);
    const session = buildAuthoritativeSoloEncounter({
        playerName: params.playerName,
        save: params.save,
        floor: aiFightFloor(profile),
        bossTemplate,
        runId: params.runId,
        seed: params.seed,
        now: params.now,
        towerId: 'ai-fight',
        admin,
        hostLoadout: params.hostLoadout,
    });
    // Seal the player's ACTIVE pet so it can be summoned onto the field once,
    // exactly as combat-start does — the local Arena AI fight allows the pet
    // summon, so omitting it would make the server fight strictly harder than
    // the one it replaces. Server-sealed from the save; the client never
    // supplies the pet's HP/damage, and the seal is consumed on use.
    const char = params.save.character as Record<string, unknown> | undefined;
    const companion = char ? sealCompanionFromSave(char) : null;
    if (companion) session.pendingCompanion = companion;
    return session;
}

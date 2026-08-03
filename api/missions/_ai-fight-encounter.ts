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
 * ── Scope note for step 3 ──────────────────────────────────────────────────
 * The opponent is built at its AUTHORED level. The client re-levels built-in
 * AIs per entry point (relevelBuiltinAi: a combat mission aligns the foe to the
 * player, hunts scale by sector, rifts rebase to player+15), and that scaling
 * rule currently lives only on the client. It is NOT read from the request
 * body on purpose — a client-chosen opponent level is a client-chosen
 * difficulty, which is the exact authority this migration exists to remove.
 * Moving each entry point's scaling rule server-side is step 3's job; until
 * then `levelOverride` exists for a SERVER-derived level and is never fed from
 * user input. Same for terrain: the floor uses the neutral 'central' biome
 * rather than the client's sector terrain (a biome grants the +10% school
 * buff), so no unearned terrain advantage is sealed in.
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
 * Build the sealed encounter. Mirrors api/missions/combat-start.ts, with the
 * opponent coming from an AI profile instead of a mission definition.
 *
 * `levelOverride` is for a SERVER-derived level only (step 3). Absent, the
 * profile's authored level is used.
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
    levelOverride?: number;
}): TowerSession {
    const admin = params.admin ?? null;
    // An explicitly supplied level always applies (clamped to the legal band);
    // only an absent / non-finite value falls through to the authored level.
    // `0` must NOT read as "no override" — that silently restores full power.
    const profile = params.levelOverride != null && Number.isFinite(params.levelOverride)
        ? { ...params.profile, level: Math.max(1, Math.min(100, Math.floor(params.levelOverride))) }
        : params.profile;
    const bossTemplate = aiOpponentEnemyTemplate(
        profile,
        resolveAiProfileJutsu(profile.jutsuIds, admin),
    );
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

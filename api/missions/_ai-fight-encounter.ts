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
import { loadAdminAiObjects } from '../_admin-ai-catalog.js';
import { validateServerAiRules } from '../combat-core/ai-authoring.js';
import {
    aiOpponentEnemyTemplate,
    buildAuthoritativeSoloEncounter,
    dynamicBossFloor,
} from '../_authoritative-pve.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { pveDifficultyGuardEnabled } from '../_pve-band-seal.js';
import {
    pveAiMasteryForLevel,
    pveDifficultyHpMultiplier,
    pveDifficultyStatMultiplier,
    scaleStatsForPveDifficulty,
} from '../_pve-difficulty.js';
import type { AdminCombatContent } from '../_admin-content.js';

/** Floor ids for AI fights. Kept clear of the combat-mission band (9_100+) and
 *  the real tower catalog so a sealed AI fight can never collide with a floor. */
export const AI_FIGHT_FLOOR_ID = 9_300;

/** Advisory only for a 'defeat-boss' objective (the engine enforces roundBudget
 *  for 'survive' floors), matched to combat-start.ts for consistency. */
export const AI_FIGHT_ROUND_BUDGET = 24;

export type AiFightProfile = Record<string, unknown> & { id: string };

function profileHasValidAiProgram(profile: AiFightProfile): boolean {
    const loadout = Array.isArray(profile.jutsuIds)
        ? profile.jutsuIds.filter((id): id is string => typeof id === 'string')
        : [];
    return validateServerAiRules(profile.rules, loadout).ok;
}

/**
 * Resolve an opponent id to a profile: the generated built-in mirror first
 * (api/_ai-profile-catalog.ts, parity-tested against the client's builtinAis),
 * then the dual-read admin AI catalog (admin slots plus canonical published
 * content), with `shared:ai-profiles` retained only as a legacy fallback.
 * Returns null for an unknown id — callers must never fabricate an opponent.
 */
export async function loadAiFightProfile(opponentId: unknown): Promise<AiFightProfile | null> {
    const id = typeof opponentId === 'string' ? opponentId.trim().slice(0, 96) : '';
    if (!id || !/^[A-Za-z0-9:_-]+$/.test(id)) return null;
    const builtin = builtinAiProfile(id);
    if (builtin) return profileHasValidAiProgram(builtin as unknown as AiFightProfile) ? builtin as unknown as AiFightProfile : null;
    try {
        const current = (await loadAdminAiObjects()).get(id);
        if (current) return profileHasValidAiProgram(current as AiFightProfile) ? current as AiFightProfile : null;
        // Compatibility for deployments that populated the retired standalone
        // key before creatorAis gained a canonical publisher.
        const authored = await kv.get<Array<Record<string, unknown>>>('shared:ai-profiles');
        if (!Array.isArray(authored)) return null;
        const match = authored.find((p) => p && typeof p === 'object' && p.id === id);
        return match && profileHasValidAiProgram(match as AiFightProfile) ? match as AiFightProfile : null;
    } catch (err) {
        // An unreachable admin list must not fail the fight start — the caller
        // falls back to the token-only path, exactly as if the id were unknown.
        console.error('[ai-fight-encounter] shared:ai-profiles read failed', safeLogValue(err));
        return null;
    }
}

/** Floor id for a sealed Endless Tower wave. Its own id so a wave is never
 *  mistaken for a generic AI fight in a log, a receipt or a session dump. */
export const ENDLESS_WAVE_FLOOR_ID = 9_310;

/** The sealed battlefield for an AI fight. Neutral biome (see the scope note). */
export function aiFightFloor(profile: AiFightProfile, floorId = AI_FIGHT_FLOOR_ID): TowerFloor {
    return dynamicBossFloor({
        id: floorId,
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
    /**
     * Which sealed mode this encounter belongs to. Both default to the generic
     * AI fight, so every existing caller is byte-identical.
     *
     * The Endless Tower (step 5 subsystem 2) passes its own pair rather than
     * getting a parallel builder: a wave IS a generic AI fight in every way that
     * matters here — one sealed opponent, no run state inside the fight — so
     * sharing this path means it inherits the jutsu-mastery seal, the PvE band
     * and the companion seal, and every future fix to them, for free. The band's
     * rollback dial stays 'AI_FIGHT' for the same reason.
     */
    floorId?: number;
    towerId?: string;
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

    // PvE difficulty band (api/_pve-difficulty.ts), keyed off the ENCOUNTER's
    // level exactly like Arena.tsx:691/:695 — the enemy soaks fewer hits and
    // fights with scaled stats in the sub-peer bands. Without this the server
    // opponent is strictly tougher than the one the client shows.
    const level = Math.max(1, Math.floor(Number(profile.level) || 1));
    // Same rollback switch as every other PvE mode (api/_pve-band-seal.ts). The
    // band is applied to the PROFILE here rather than to the built actors, so
    // this path keeps its own arithmetic — but it must answer to the same
    // switch, or DISABLE_PVE_DIFFICULTY_GUARD=1 would leave AI fights armed.
    const banded = pveDifficultyGuardEnabled('AI_FIGHT');
    const tuned: AiFightProfile = !banded ? profile : {
        ...profile,
        hp: Math.max(1, Math.floor(Number(profile.hp) * pveDifficultyHpMultiplier(level))),
        stats: scaleStatsForPveDifficulty(
            (profile.stats ?? {}) as Record<string, number>,
            pveDifficultyStatMultiplier(level),
        ),
    };
    const bossTemplate = aiOpponentEnemyTemplate(tuned, loadout);
    const session = buildAuthoritativeSoloEncounter({
        playerName: params.playerName,
        save: params.save,
        floor: aiFightFloor(profile, params.floorId ?? AI_FIGHT_FLOOR_ID),
        bossTemplate,
        runId: params.runId,
        seed: params.seed,
        now: params.now,
        towerId: params.towerId ?? 'ai-fight',
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

    // Seal the AI's JUTSU MASTERY. api/pvp/move.ts applyJutsu reads the caster's
    // `character.jutsuMastery`, and no server enemy template has ever carried
    // one — so every server-sealed AI casts at mastery 0, i.e.
    // masteryDamageFrac(0) = 0.3, THIRTY PERCENT of the jutsu damage the
    // client's PvE AI deals (it passes pveAiMasteryForLevel explicitly). Left
    // alone, a migrated AI fight would be a pushover.
    //
    // Scoped to this session on purpose: the same gap exists for missions,
    // story bosses, hollow gate and the towers, whose enemy templates were
    // hand-tuned with mastery 0 in place. Fixing those is a balance change and
    // needs its own deliberate pass — see the handoff.
    const mastery = pveAiMasteryForLevel(Number(bossTemplate.level) || 1);
    const boss = session.actors.find((actor) => actor.id === 'boss');
    if (boss && Array.isArray(boss.character.jutsu)) {
        boss.character.jutsuMastery = (boss.character.jutsu as Array<{ id?: unknown }>)
            .map((jutsu) => ({ jutsuId: String(jutsu?.id ?? ''), level: mastery }))
            .filter((entry) => entry.jutsuId);
    }

    // Arm the standard-PvE hit guard for this session. Presence is the gate —
    // no existing mode seals this, so none of them change. The band is keyed to
    // the opponent's SEALED level so the client cannot shift it mid-fight.
    if (banded) {
        session.pveGuard = {
            enemyLevel: Number(bossTemplate.level) || 1,
            turnStartHp: {},
            dealtThisTurn: {},
        };
    }
    return session;
}

/*
 * Generic AI profile authority shared by standalone Solo-PvE entry points.
 *
 * `loadAiFightProfile` is the async catalog boundary: generated built-ins first,
 * then current admin content, then the retired standalone key as a compatibility
 * read. The actual encounter is built by `solo-pve/_ai-encounter.ts`; keeping
 * profile resolution separate lets starts reconstruct an opponent without
 * accepting combat fields from the request.
 *
 * ── Opponent scaling ───────────────────────────────────────────────────────
 * Absent a `scaling` argument the Solo-PvE builder uses the authored level.
 * Entry-point adapters may request the parity-tested rebuild in
 * `api/_ai-level-curves.ts` when server-owned mission/run state requires it.
 *
 * `scaling` must be derived from SERVER-KNOWN state (the save's level, the
 * mission/contract definition), never from the request body. A client-chosen
 * opponent level is a client-chosen difficulty, which is the exact authority
 * this authority boundary exists to remove. `ai-fight-start` deliberately does
 * not read `opponentLevel` when sealing combat.
 */
import { kv } from '../_storage.js';
import { safeLogValue } from '../_safe-log.js';
import { loadAdminAiObjects } from '../_admin-ai-catalog.js';
import { validateServerAiRules } from '../combat-core/ai-authoring.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';

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
        // An unreachable admin list is treated like an unknown profile. The
        // authoritative start then rejects it without minting a combat token.
        console.error('[ai-fight-encounter] shared:ai-profiles read failed', safeLogValue(err));
        return null;
    }
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

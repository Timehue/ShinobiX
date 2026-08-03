import { randomUUID } from 'node:crypto';
import type { TowerSession } from '../towers/_tower-session.js';
import type { AdminCombatContent } from '../_admin-content.js';
import {
    buildAiFightEncounter,
    ENDLESS_WAVE_FLOOR_ID,
    type AiFightProfile,
} from '../missions/_ai-fight-encounter.js';
import { pickEndlessWaveOpponent } from './_wave-opponent.js';

/*
 * Sealed Endless Tower waves — step 5 subsystem 2 of the AI-fight migration.
 *
 * Endless was the odd mode out: its ECONOMY has been server-authoritative for a
 * long time (api/endless/_run.ts recomputes the entry cost, the per-wave ryo,
 * the milestone drops and the cash-out from the wave number), while the FIGHT
 * was not. `action:'win'` was the client asserting "I beat wave N, and these are
 * the vitals I finished on".
 *
 * The old proof was an AiFightToken whose opponentId ended in `-w<wave>`. That
 * proves a wave-N fight was STARTED, never that it was won — the token is minted
 * before the first blow lands. This module supplies the missing half: a real
 * sealed session, bound to the run and the wave, whose recorded outcome is what
 * the win reads.
 *
 * The binding is separate from the session on purpose, exactly as the story lane
 * does it: the session says what happened in the fight, the binding says which
 * run and which wave that fight was FOR. Without it a player could seal a cheap
 * wave-1 encounter and hand it in as wave 40.
 */

export const ENDLESS_WAVE_TTL_MS = 45 * 60 * 1000;
export const ENDLESS_WAVE_TTL_SECONDS = Math.ceil(ENDLESS_WAVE_TTL_MS / 1000);

export function endlessWaveBindingKey(runId: string): string {
    return `endless-wave-binding:${runId}`;
}

export function endlessWaveRunId(): string {
    return `endlesswave-${randomUUID().replace(/-/g, '')}`;
}

export interface EndlessWaveBinding {
    version: 1;
    runId: string;
    playerName: string;
    /** The endless RUN's token — ties this fight to one run, not just one player. */
    runToken: string;
    wave: number;
    opponentId: string;
    createdAt: number;
    expiresAt: number;
    status: 'active' | 'won' | 'spent';
    settledAt?: number;
}

export type EndlessWaveValidation =
    | { ok: true; binding: EndlessWaveBinding }
    | { ok: false; reason: 'invalid-binding' | 'wrong-player' | 'wrong-run' | 'wrong-wave' | 'expired' | 'already-settled' | 'not-complete' | 'not-won' | 'not-a-member' };

export function createEndlessWaveBinding(params: {
    runId: string;
    playerName: string;
    runToken: string;
    wave: number;
    opponentId: string;
    now?: number;
}): EndlessWaveBinding {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        runId: params.runId,
        playerName: params.playerName,
        runToken: params.runToken,
        wave: Math.max(1, Math.floor(params.wave)),
        opponentId: params.opponentId,
        createdAt: now,
        expiresAt: now + ENDLESS_WAVE_TTL_MS,
        status: 'active',
    };
}

export function settleEndlessWaveBinding(binding: EndlessWaveBinding, now = Date.now()): EndlessWaveBinding {
    if (binding.status !== 'active' || binding.settledAt) return binding;
    return { ...binding, status: 'won', settledAt: now };
}

/**
 * Was this wave really won, by this player, on this run, at this wave?
 *
 * `expectedWave` comes from the SAVE's own run record, never from the request —
 * that is what stops a sealed wave-1 win being redeemed against wave 40, which
 * pays several times more.
 */
export function validateCompletedEndlessWave(params: {
    binding: EndlessWaveBinding | null | undefined;
    session: TowerSession | null | undefined;
    playerName: string;
    runToken: string;
    expectedWave: number;
    now?: number;
}): EndlessWaveValidation {
    const { binding, session, playerName, runToken, expectedWave } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.runId) return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName) return { ok: false, reason: 'wrong-player' };
    if (!binding.runToken || binding.runToken !== runToken) return { ok: false, reason: 'wrong-run' };
    if (binding.wave !== Math.max(1, Math.floor(Number(expectedWave) || 0))) return { ok: false, reason: 'wrong-wave' };
    if (!session || session.runId !== binding.runId) return { ok: false, reason: 'invalid-binding' };
    if (binding.expiresAt <= now) return { ok: false, reason: 'expired' };
    if (binding.settledAt || binding.status !== 'active') return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done') return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'squad') return { ok: false, reason: 'not-won' };
    if (!session.actors.some((actor) => actor.side === 'squad' && actor.ownerSlug === playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    return { ok: true, binding };
}

/** The player's vitals AS THE SERVER RECORDED THEM — this is what replaces the
 *  client-reported `{hp, chakra, stamina}` the win used to carry in its body. */
export function endlessWaveVitals(session: TowerSession, playerName: string): { hp: number; chakra: number; stamina: number } {
    const actor = session.actors.find((candidate) => candidate.side === 'squad' && candidate.ownerSlug === playerName);
    const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));
    return { hp: whole(actor?.hp), chakra: whole(actor?.chakra), stamina: whole(actor?.stamina) };
}

/**
 * Build the sealed wave. The opponent is generated here from run state
 * (./_wave-opponent.ts) — the request supplies no opponent, level or stats.
 *
 * Shares `buildAiFightEncounter` with generic AI fights rather than duplicating
 * it, so a wave inherits the jutsu-mastery seal, the PvE band and the companion
 * seal. It passes its own floor id and towerId so a wave is still identifiable
 * as a wave. No `scaling` is passed: the opponent arrives ALREADY scaled by the
 * wave curve, and re-levelling it here would apply the curve twice.
 */
export function buildEndlessWaveEncounter(params: {
    playerName: string;
    save: Record<string, unknown>;
    runToken: string;
    wave: number;
    playerLevel: number;
    runId: string;
    seed: number;
    now: number;
    admin?: AdminCombatContent | null;
    hostLoadout?: Record<string, unknown>;
}): { session: TowerSession; opponentId: string } | null {
    const opponent = pickEndlessWaveOpponent({
        runToken: params.runToken,
        wave: params.wave,
        playerLevel: params.playerLevel,
    });
    if (!opponent) return null;
    const session = buildAiFightEncounter({
        playerName: params.playerName,
        save: params.save,
        profile: opponent as unknown as AiFightProfile,
        runId: params.runId,
        seed: params.seed,
        now: params.now,
        admin: params.admin ?? null,
        hostLoadout: params.hostLoadout,
        floorId: ENDLESS_WAVE_FLOOR_ID,
        towerId: 'endless-wave',
    });
    return { session, opponentId: opponent.id };
}

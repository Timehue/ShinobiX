/*
 * One-time "traveler's codex" claim — the Chronicle Scribe road event's grant.
 *
 * The grant itself is the SAME quantity floor the lazy first-duel path already
 * applies (resolveChronicleDeckWithSave in ./_deck.ts tops every player up to
 * CHRONICLE_STARTER_GRANT_IDS): claiming only fills in whatever starter copies
 * the player doesn't own yet, so it can never double-grant and never mints
 * anything the player wouldn't receive anyway. What IS new is the boolean
 * `starterCardsClaimed` latch (starterPetClaimed pattern): it retires the
 * roaming scribe NPC after one claim, and api/save/[name].ts preserves it
 * against stale client saves.
 */
import { CHRONICLE_STARTER_GRANT_IDS, countChronicleCards } from '../../shared/chronicle-duel.js';
import { kv } from '../_storage.js';

/** Error string the locked card surfaces return; the client keys off it. */
export const CHRONICLE_LOCKED_ERROR = 'chronicle-locked';

/** True once the player holds the traveler's codex (the scribe event set the
 * latch). Gates the PLAYER-INITIATED Chronicle surfaces — AI duels, the PvP
 * queue, and both pack-purchase paths. War-embedded card checks (clan war
 * tilecards, village sector-card) intentionally stay open: those are team
 * content where a still-locked defender must auto-resolve. */
export function chronicleUnlocked(character: unknown): boolean {
    return !!character && typeof character === 'object'
        && (character as Record<string, unknown>).starterCardsClaimed === true;
}

/** Read-only save lookup for handlers that don't otherwise load the save.
 * Fails OPEN on a storage hiccup: this lock is onboarding pacing, not an
 * economy guard — the codex grant itself is an idempotent quantity floor
 * either way, so nothing mintable hides behind it. */
export async function chronicleUnlockedFor(playerName: string): Promise<boolean> {
    try {
        const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = record && typeof record === 'object' ? (record as { character?: unknown }).character : null;
        return chronicleUnlocked(character);
    } catch {
        return true;
    }
}

/** The scribe looks for shinobi who have found their feet on the road — the
 *  quiet stretch after the academy arc. Mirrored by the client spawn gate in
 *  shinobij.client/src/lib/chronicle-scribe.ts. */
export const STARTER_CARDS_MIN_LEVEL = 17;

export function claimStarterCards(character: Record<string, unknown>) {
    if (character.starterCardsClaimed === true) {
        return { ok: false as const, reason: 'already-claimed' as const };
    }
    if ((Number(character.level) || 0) < STARTER_CARDS_MIN_LEVEL) {
        return { ok: false as const, reason: 'level' as const };
    }
    const current = Array.isArray(character.tileCards)
        ? (character.tileCards as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    const currentCounts = countChronicleCards(current);
    const starterCounts = countChronicleCards(CHRONICLE_STARTER_GRANT_IDS);
    const granted = [...starterCounts].flatMap(([id, required]) =>
        Array.from({ length: Math.max(0, required - (currentCounts.get(id) ?? 0)) }, () => id));
    return {
        ok: true as const,
        granted,
        character: {
            ...character,
            tileCards: [...current, ...granted],
            starterCardsClaimed: true,
        },
    };
}

import type { Achievement } from "../constants/achievements";
import type { Character } from "../types/character";
import {
    claimAchievementSync,
    planAchievementSync,
    releaseAchievementSync,
    syncedToastIds,
    versionedAchievementMutationFromSync,
    type AchievementSyncGate,
    type AchievementSyncResponse,
} from "./achievement-sync";
import { markAchievementsToasted, unseenAchievements } from "./achievement-toast-ledger";

/*
 * One pass of App's achievement-sync effect, which starts a pass on every
 * character change once gameplay opens. A pass loads the presentation catalog,
 * plans against the character, and, when the gate allows it, asks
 * POST /api/achievements/sync to reconcile and adopts the authoritative reply.
 * Read ./achievement-sync first: its header explains why the server owns this
 * state and why the gate exists. This module only sequences those pieces.
 */

/** The two catalog exports a pass reads. */
export interface AchievementCatalog {
    ACHIEVEMENTS: ReadonlyArray<Achievement>;
    titlesForAchievementIds: (ids: Iterable<string>) => string[];
}

/**
 * The catalog holds 135 descriptions and predicates. The server is
 * authoritative and nothing reads the catalog before gameplay opens, so it is
 * loaded on demand to keep it out of the render-blocking startup graph.
 *
 * This is a plain import(), deliberately not retryDynamicImport. Both halves of
 * that wrapper were measured on 2026-09-13 in Chromium, Firefox and WebKit, and
 * neither helps here:
 * - The retry cannot rescue a chunk that failed. Each browser rejected the
 *   second attempt from its cached failure without requesting the chunk again.
 *   A pass started 40 s later failed the same way, so a failed chunk stays
 *   failed until the page reloads.
 * - The per-attempt timeout would make things worse. A pass that gives up after
 *   about 25 s cannot sync a slow chunk when it finally lands. It waits for the
 *   next character change instead, whereas the App code this replaced synced
 *   the moment the chunk arrived.
 * A failed load costs only its own pass (see runAchievementSyncPass), so
 * catching the failure is enough.
 */
export function loadAchievementCatalog(): Promise<AchievementCatalog> {
    return import("../constants/achievements");
}

export interface AchievementSyncPassInput {
    playerName: string;
    /** The character the effect ran for. Eligibility is judged against it. */
    character: Character;
    gate: AchievementSyncGate;
    /** True once the effect that started this pass has been cleaned up. */
    isCancelled: () => boolean;
    /** App's live character ref, read when the server reply lands. */
    characterRef: { readonly current: Character | null };
    /** App's atomic character+version adoption. */
    commitVersionedCharacter: (character: Character, saveVersion: unknown) => boolean;
    /** Receives the achievements to toast, in the order the server reported them. */
    onToasts: (achievements: Achievement[]) => void;
    /** Test seam. Defaults to loadAchievementCatalog. */
    loadCatalog?: () => Promise<AchievementCatalog>;
}

/**
 * Resolves, and never rejects, when the catalog fails to load. That failure
 * happens in production: a deploy removes the chunk while a player's tab is
 * still open, or a mobile network drops the request. Before this was handled,
 * the rejection escaped App's fire-and-forget promise unhandled. In a build
 * with a Sentry DSN, lib/sentry's unhandledrejection listener reported it.
 * Playwright records the same rejection as a `pageerror`, so it also failed
 * any e2e spec that asserts none occurred. That made it a flake source across
 * specs whenever the machine was under load.
 *
 * A failed load skips the pass silently. The gate is claimed only after the
 * catalog has loaded, so neither a failed load nor a pass cancelled mid-load
 * leaves a signature behind, and a later pass can still sync the same
 * divergence once the catalog is available.
 */
export async function runAchievementSyncPass(input: AchievementSyncPassInput): Promise<void> {
    const { playerName, character, gate, isCancelled, characterRef, commitVersionedCharacter, onToasts } = input;
    let catalog: AchievementCatalog;
    try {
        catalog = await (input.loadCatalog ?? loadAchievementCatalog)();
    } catch {
        return;
    }
    if (isCancelled()) return;
    const { ACHIEVEMENTS, titlesForAchievementIds } = catalog;
    const eligibleIds = ACHIEVEMENTS.filter(a => a.check(character)).map(a => a.id);
    const plan = planAchievementSync({
        eligibleIds,
        unlocked: character.unlockedAchievements,
        earnedTitles: character.earnedTitles,
        titlesForUnlocked: titlesForAchievementIds(eligibleIds),
    });
    // First-ever sync for this save: the server seeds its claim ledger
    // so existing progress pays no retroactive windfall.
    const silent = plan.uninitialized;
    if (!claimAchievementSync(gate, playerName, plan)) return;
    try {
        const res = await fetch('/api/achievements/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName }),
        });
        if (!res.ok) return;
        const data = await res.json() as AchievementSyncResponse;
        const mutation = versionedAchievementMutationFromSync(characterRef.current, data);
        if (!mutation || mutation.character.name.toLowerCase() !== playerName.toLowerCase()) return;
        if (!commitVersionedCharacter(mutation.character, mutation._saveVersion)) return;
        if (silent) { markAchievementsToasted(playerName, mutation.character.unlockedAchievements); return; }
        const toastIds = unseenAchievements(playerName, syncedToastIds(data));
        if (toastIds.length === 0) return;
        markAchievementsToasted(playerName, toastIds);
        onToasts(toastIds
            .map(id => ACHIEVEMENTS.find(a => a.id === id))
            .filter((a): a is Achievement => !!a));
    } catch {
        // Offline / auth blip: retries on the next unlock or page load.
        // Deliberately no immediate retry — that was the loop.
    } finally {
        releaseAchievementSync(gate);
    }
}

/*
 * Server-side registry of every EARNABLE title (docs/legacy-system-plan.md §11).
 *
 * customTitle is a client-writable save field, so "is this an earned title the
 * player actually owns?" must be answerable server-side: the save sanitizer
 * allows an earned-looking title only when it appears BOTH here (a real title
 * the game grants) AND in a server-trusted ownership source (character.legacy
 * .titles, which the sanitizer itself protects, or earnedTitles for
 * achievement titles — bounded client trust, same as achievements themselves).
 *
 * Achievement titles are MIRRORED from shinobij.client/src/constants/
 * achievements.ts TITLE_ACHIEVEMENT_IDS — the drift test in
 * _text-moderation-titles.test.ts counts them so a new client title without a
 * registry entry fails npm test.
 */
import { LEGACY_DEFS } from './_legacy-defs.js';
import { ERA_DEFS } from './_era-defs.js';

/** Wearable achievement titles (client constants/achievements.ts mirror). */
export const ACHIEVEMENT_TITLES: readonly string[] = [
    'Centenarian',          // level-100
    'Slayer of Thousands',  // pve-2500
    'Warlord',              // pvp-250
    'Crimson Sovereign',    // pvp-1000
    'Tempered Steel',       // ranked-1800
    'Apex Predator',        // ranked-2200
    'Season Champion',      // ranked-season-champ
    'Mission Master',       // mission-1000
    'World Walker',         // explore-5000
    'Ryo Tycoon',           // ryo-5m
    'Sealed Legend',        // honor-500
    'Fate Weaver',          // fate-2500
    'Eternal Aura',         // aura-300
    'Village Scourge',      // raid-250
    'Arena Champion',       // tournament-3
    'Tower Survivor',       // tower-25
    'Beast Tamer',          // pet-100
    'Clan Founder',         // clan-founder
    'Encyclopedia',         // secret-bestiary-200
    'Polyelementalist',     // secret-elements-3
    'Weekly Reaper',        // secret-weekly-bosses-5
    'War Veteran',          // secret-war-vet-50
];

/** Every title the game can grant, lowercased for comparisons. */
export const KNOWN_EARNED_TITLES: ReadonlySet<string> = new Set([
    ...ACHIEVEMENT_TITLES,
    ...LEGACY_DEFS.map((d) => d.title),
    ...ERA_DEFS.flatMap((e) => (e.trigger ? [e.trigger.title] : [])),
].map((t) => t.toLowerCase()));

/**
 * LEGACY titles demand the STRICT ownership source: stored
 * character.legacy.titles, which only the trial endpoint writes and the save
 * sanitizer re-injects. earnedTitles is client-writable (achievements are
 * client-trusted by long-standing precedent), so accepting it for legacy
 * titles would let a tampered save wear "Moonlit Ghost" without the trial —
 * exactly the impersonation the handoff forbids.
 */
export const LEGACY_ONLY_TITLES: ReadonlySet<string> = new Set(
    LEGACY_DEFS.map((d) => d.title.toLowerCase()),
);

/** Era trigger titles ("Herald of the Mythic Age") are server-credited
 *  once-ever rewards — like legacy titles they must NOT be verifiable against
 *  the client-writable earnedTitles. They live in the server-owned title vault
 *  (character.serverTitles), which the save sanitizer re-injects. */
export const ERA_TRIGGER_TITLES: ReadonlySet<string> = new Set(
    ERA_DEFS.flatMap((e) => (e.trigger ? [e.trigger.title.toLowerCase()] : [])),
);

/** Normalize a title for comparison: collapse internal whitespace + lowercase
 *  so "Moonlit  Ghost" can't wear a pixel-identical unowned title. */
export function normalizeTitleKey(text: string): string {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isKnownEarnedTitle(text: string): boolean {
    return KNOWN_EARNED_TITLES.has(normalizeTitleKey(text));
}

/** Server-credited titles that require the strict (server-owned) ownership
 *  source rather than client-writable earnedTitles. */
export function isServerCreditedTitle(text: string): boolean {
    const key = normalizeTitleKey(text);
    return LEGACY_ONLY_TITLES.has(key) || ERA_TRIGGER_TITLES.has(key);
}

export function isLegacyOnlyTitle(text: string): boolean {
    return LEGACY_ONLY_TITLES.has(normalizeTitleKey(text));
}

// ─── Custom-title review log ────────────────────────────────────────────────
// Every NEW free-text title a save adopts is recorded here (newest-first ring,
// capped) so admins can review + revoke after the fact — the filter-first
// moderation model from docs/legacy-system-plan.md §11.4. Best-effort.

export type CustomTitleLogEntry = { ts: number; player: string; title: string };

export const CUSTOM_TITLE_LOG_KEY = 'titles:custom-log';
const CUSTOM_TITLE_LOG_CAP = 200;

export async function appendCustomTitleLog(player: string, title: string): Promise<void> {
    try {
        const { kv } = await import('./_storage.js');
        const { withKvLock } = await import('./_lock.js');
        await withKvLock(CUSTOM_TITLE_LOG_KEY, async () => {
            const list = (await kv.get<CustomTitleLogEntry[]>(CUSTOM_TITLE_LOG_KEY)) ?? [];
            const arr = Array.isArray(list) ? list : [];
            // Collapse repeat saves of the same title by the same player.
            if (arr[0]?.player === player && arr[0]?.title === title) return;
            await kv.set(CUSTOM_TITLE_LOG_KEY, [{ ts: Date.now(), player, title }, ...arr].slice(0, CUSTOM_TITLE_LOG_CAP));
        });
    } catch (err) {
        console.error('[titles] custom-log append failed:', err instanceof Error ? err.message : err);
    }
}

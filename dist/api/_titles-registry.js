"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CUSTOM_TITLE_LOG_KEY = exports.TITLE_ICON_SET = exports.TITLE_STYLE_IDS = exports.ERA_TRIGGER_TITLES = exports.LEGACY_ONLY_TITLES = exports.KNOWN_EARNED_TITLES = exports.ACHIEVEMENT_TITLES = void 0;
exports.normalizeTitleKey = normalizeTitleKey;
exports.isKnownEarnedTitle = isKnownEarnedTitle;
exports.isServerCreditedTitle = isServerCreditedTitle;
exports.isLegacyOnlyTitle = isLegacyOnlyTitle;
exports.appendCustomTitleLog = appendCustomTitleLog;
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
const _legacy_defs_js_1 = require("./_legacy-defs.js");
const _era_defs_js_1 = require("./_era-defs.js");
const _legacy_core_js_1 = require("./_legacy-core.js");
/** Every legacy title plus its Stage-4/5 prestige variants ("Proven X",
 *  "Eternal X") — all server-credited, granted only by the trial endpoint. */
const ALL_LEGACY_TITLES = _legacy_defs_js_1.LEGACY_DEFS.flatMap((d) => [
    d.title, (0, _legacy_core_js_1.provenTitleFor)(d.title), (0, _legacy_core_js_1.mythicTitleFor)(d.title),
]);
/** Wearable achievement titles (client constants/achievements.ts mirror). */
exports.ACHIEVEMENT_TITLES = [
    'Centenarian', // level-100
    'Slayer of Thousands', // pve-2500
    'Warlord', // pvp-250
    'Crimson Sovereign', // pvp-1000
    'Tempered Steel', // ranked-1800
    'Apex Predator', // ranked-2200
    'Season Champion', // ranked-season-champ
    'Mission Master', // mission-1000
    'World Walker', // explore-5000
    'Ryo Tycoon', // ryo-5m
    'Sealed Legend', // honor-500
    'Fate Weaver', // fate-2500
    'Eternal Aura', // aura-300
    'Village Scourge', // raid-250
    'Arena Champion', // tournament-3
    'Tower Survivor', // tower-25
    'Beast Tamer', // pet-100
    'Clan Founder', // clan-founder
    'Encyclopedia', // secret-bestiary-200
    'Polyelementalist', // secret-elements-3
    'Weekly Reaper', // secret-weekly-bosses-5
    'War Veteran', // secret-war-vet-50
];
/** Every title the game can grant, lowercased for comparisons. */
exports.KNOWN_EARNED_TITLES = new Set([
    ...exports.ACHIEVEMENT_TITLES,
    ...ALL_LEGACY_TITLES,
    ..._era_defs_js_1.ERA_DEFS.flatMap((e) => (e.trigger ? [e.trigger.title] : [])),
].map((t) => t.toLowerCase()));
/**
 * LEGACY titles demand the STRICT ownership source: stored
 * character.legacy.titles, which only the trial endpoint writes and the save
 * sanitizer re-injects. earnedTitles is client-writable (achievements are
 * client-trusted by long-standing precedent), so accepting it for legacy
 * titles would let a tampered save wear "Moonlit Ghost" without the trial —
 * exactly the impersonation the handoff forbids.
 */
exports.LEGACY_ONLY_TITLES = new Set(ALL_LEGACY_TITLES.map((t) => t.toLowerCase()));
/** Era trigger titles ("Herald of the Mythic Age") are server-credited
 *  once-ever rewards — like legacy titles they must NOT be verifiable against
 *  the client-writable earnedTitles. They live in the server-owned title vault
 *  (character.serverTitles), which the save sanitizer re-injects. */
exports.ERA_TRIGGER_TITLES = new Set(_era_defs_js_1.ERA_DEFS.flatMap((e) => (e.trigger ? [e.trigger.title.toLowerCase()] : [])));
/** Normalize a title for comparison: collapse internal whitespace + lowercase
 *  so "Moonlit  Ghost" can't wear a pixel-identical unowned title. */
function normalizeTitleKey(text) {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}
/** Title-cosmetic allowlists (canonical server copy — mirror of the client's
 *  TITLE_STYLES/TITLE_ICONS in shinobij.client/src/lib/legacy.ts). Used by the
 *  save sanitizer AND the presence slimmer so a hostile client can neither
 *  persist nor broadcast an off-list value. '' = the free default. */
exports.TITLE_STYLE_IDS = new Set([
    '', 'ember', 'frost', 'verdant', 'shadow', 'royal', 'crimson',
]);
exports.TITLE_ICON_SET = new Set([
    '', '⚔️', '🌙', '🔥', '❄️', '🍃', '👑', '🐺', '⭐',
]);
function isKnownEarnedTitle(text) {
    return exports.KNOWN_EARNED_TITLES.has(normalizeTitleKey(text));
}
/** Server-credited titles that require the strict (server-owned) ownership
 *  source rather than client-writable earnedTitles. */
function isServerCreditedTitle(text) {
    const key = normalizeTitleKey(text);
    return exports.LEGACY_ONLY_TITLES.has(key) || exports.ERA_TRIGGER_TITLES.has(key);
}
function isLegacyOnlyTitle(text) {
    return exports.LEGACY_ONLY_TITLES.has(normalizeTitleKey(text));
}
exports.CUSTOM_TITLE_LOG_KEY = 'titles:custom-log';
const CUSTOM_TITLE_LOG_CAP = 200;
async function appendCustomTitleLog(player, title) {
    try {
        const { kv } = await import('./_storage.js');
        const { withKvLock } = await import('./_lock.js');
        await withKvLock(exports.CUSTOM_TITLE_LOG_KEY, async () => {
            const list = (await kv.get(exports.CUSTOM_TITLE_LOG_KEY)) ?? [];
            const arr = Array.isArray(list) ? list : [];
            // Collapse repeat saves of the same title by the same player.
            if (arr[0]?.player === player && arr[0]?.title === title)
                return;
            await kv.set(exports.CUSTOM_TITLE_LOG_KEY, [{ ts: Date.now(), player, title }, ...arr].slice(0, CUSTOM_TITLE_LOG_CAP));
        });
    }
    catch (err) {
        console.error('[titles] custom-log append failed:', err instanceof Error ? err.message : err);
    }
}

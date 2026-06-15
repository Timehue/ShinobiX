"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const REGISTRY_KEY = 'player:registry';
// Fields stripped from EVERY character before the roster goes out the door.
// Previously this endpoint returned `save.character` verbatim, leaking ryo,
// inventory, equipment, jutsu loadouts, currencies, daily-claim ledgers,
// and lifetime mission ledgers to any anonymous caller. The full character
// blob is needed by api/save/[name].ts when the OWNER reads their own save;
// the roster never returns own-save data, so we can safely strip everything
// here.
//
// Blacklist (not whitelist) because the field set grows as new features land
// and a forgotten whitelist entry would silently break opponent rendering.
// Keep this list aligned with the "sensitive" half of save/[name].ts's
// COMBAT_STRIP_CHAR_FIELDS — anything that hands an attacker scouting info
// (jutsu, equipment, stats) OR an economic target (currencies, inventory)
// belongs here.
const ROSTER_STRIP_CHAR_FIELDS = new Set([
    // Currencies
    'ryo', 'bankRyo', 'honorSeals', 'fateShards', 'boneCharms',
    'auraStones', 'mythicSeals', 'auraDust',
    // Loadout / scouting surface
    'inventory', 'itemStacks', 'tileCards', 'savedTileDeck',
    'jutsu', 'jutsuMastery', 'equippedJutsu', 'signatureJutsu',
    'equipment', 'equippedSet',
    'stats', 'trainedStats', 'statPoints',
    'bloodlines', 'activeBloodline',
    // Daily / weekly ledgers
    'dailyAiKills', 'dailyPetWins', 'dailyTilesExplored', 'dailyMissionsCompleted',
    'dailyFateSpins', 'lastDailyReset',
    'dailyHonorSealsEarned', 'dailyHonorSealsByTarget', 'vanguardDailyResetDate',
    'lastExpeditionClaimDate', 'expeditionsClaimedToday',
    'dailyDonatedSeals', 'dailyDonationDate',
    'claimedVillageAgendaDate', 'claimedMapControlDate',
    // Mission / quest journals
    'missions', 'missionLog', 'completedMissions', 'activeMissions',
    'questLog', 'bankLog',
    'totalMissionsCompleted', 'totalStatsTrained',
    // Story-only persistence
    'storyTraits', 'storyTitle', 'storyProgress',
    'defeatedAiIds', 'elderFocus', 'examsPassed',
    'triggeredEvents',
    // Run-state for solo modes
    'hollowGateRun', 'hollowGateWardenKills', 'hollowGateIntroSeen',
    'endlessTowerRun', 'endlessTowerBestWave',
    'weeklyBossKills', 'claimedWarCrateIds',
    'unlockedAchievements', 'achievementUnlockedAt',
    'villageWarMissionDate', 'villageWarRaidProgress', 'villageWarMissionsCompleted',
    'clanBattleContrib', 'clanEventContrib', 'clanMissionContrib', 'clanContribMonth',
    'petEscortBonusReady', 'hunterRank',
    'lastBankInterestAt',
    'creatorAis', 'creatorEvents', 'creatorMissions', 'creatorRaids', 'creatorCards',
    'createdAt', 'professionChosenAt',
]);
// Pet entries: keep enough for the arena to use the OPPONENT'S actual
// level-scaled stats (not the rarity-base template) AND for
// isPetOnExpedition() to work for opponent pets. Without hp/attack/
// defense/speed/jutsus, the client's normalizePet() backfills from
// the petPool template — which uses base rarity stats, NOT level-
// scaled — so every opponent pet fights at base stats regardless of
// training. The metagame concern from the audit is real but secondary
// to "opponent pets actually fight at their actual level". expedition
// is a {expeditionId, endsAt} stamp — not sensitive, just needed for
// the "available to battle" filter.
const PET_PUBLIC_FIELDS = new Set([
    'id', 'name', 'image', 'rarity', 'level', 'element', 'trait', 'species',
    'hp', 'attack', 'defense', 'speed',
    'jutsus', 'xp', 'unlockedForPve',
    'expedition',
]);
function projectPet(p) {
    if (!p || typeof p !== 'object')
        return p;
    const src = p;
    const out = {};
    for (const k of PET_PUBLIC_FIELDS)
        if (k in src)
            out[k] = src[k];
    return out;
}
// Defense-in-depth pattern guard (audit item #24). The explicit blacklist
// above is intentionally a blacklist (not a whitelist) so a new *display*
// field doesn't silently break opponent rendering — but that means a new
// *sensitive* field would silently LEAK until someone remembers to add it to
// the strip set. This regex auto-strips any field whose name looks like a
// currency, secret, or PII channel even if it's not yet listed explicitly.
// Patterns are deliberately precise to avoid colliding with legitimate public
// display fields. They target (a) the known currency tokens as they actually
// appear in field names and (b) unambiguous secret/PII markers — NOT broad
// substrings like "stone" (would catch "milestone") or "bank" alone. The
// public fields (name/level/village/specialty/avatarImage/rankTitle/
// customTitle/profession/professionRank/rankedRating/clan/pets) match none of
// these, so this only ever removes things that should never be public.
const ROSTER_SENSITIVE_NAME_RE = /\bryo\b|honorseal|fateshard|bonecharm|aurastone|mythicseal|auradust|password|secret|token|apikey|api_key|\bemail\b|\bphone\b|fingerprint|payment|stripe|patreon|\bssn\b/i;
function rosterProjection(character) {
    if (!character || typeof character !== 'object')
        return character;
    const src = character;
    const out = {};
    for (const [k, v] of Object.entries(src)) {
        if (ROSTER_STRIP_CHAR_FIELDS.has(k))
            continue;
        // Belt-and-suspenders: drop anything that looks sensitive by name even
        // if it's not in the explicit strip list (future-field leak guard).
        if (ROSTER_SENSITIVE_NAME_RE.test(k))
            continue;
        if (k === 'pets' && Array.isArray(v)) {
            out[k] = v.map(projectPet);
            continue;
        }
        out[k] = v;
    }
    return out;
}
function normalizeSector(value, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector))
        return fallback;
    return Math.max(0, Math.floor(sector));
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    // Intentionally unauthenticated — StartScreen renders the public
    // leaderboard pre-login. The security boundary for this endpoint is
    // `rosterProjection` below, NOT an auth gate. Anything sensitive
    // (ryo, inventory, jutsu, stats, currencies, daily ledgers) MUST be
    // listed in ROSTER_STRIP_CHAR_FIELDS — and pet entries get their own
    // PET_PUBLIC_FIELDS whitelist before going out.
    try {
        // Live presence comes from the in-memory store (no DB scan). `name` is
        // already lowercased; `character` is the slim presence character.
        const presenceEntries = online_store_js_1.onlineStore.list();
        const livePresenceByName = new Map(presenceEntries.map(p => [p.name, p]));
        const onlineNames = new Set(livePresenceByName.keys());
        // Primary: persistent registry (every player who ever connected)
        const rawRegistry = await _storage_js_1.kv.hgetall(REGISTRY_KEY) ?? {};
        const registryKeys = Object.keys(rawRegistry);
        // Batch-fetch all saves in one command instead of N sequential kv.get() calls.
        const saveKeys = registryKeys.map(k => `save:${k}`);
        const saves = saveKeys.length > 0
            ? await _storage_js_1.kv.mget(...saveKeys)
            : [];
        const players = [];
        for (let i = 0; i < registryKeys.length; i++) {
            const key = registryKeys[i];
            const value = rawRegistry[key];
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                const save = saves[i] ?? null;
                const livePresence = livePresenceByName.get((entry.name ?? '').toLowerCase());
                const rawCharacter = livePresence?.character ?? save?.character;
                const character = rosterProjection(rawCharacter);
                players.push({
                    name: entry.name ?? '',
                    level: entry.level ?? 1,
                    village: entry.village ?? '',
                    specialty: entry.specialty ?? '',
                    online: onlineNames.has((entry.name ?? '').toLowerCase()),
                    character,
                    currentSector: normalizeSector(livePresence?.sector, normalizeSector(save?.currentSector, 40)),
                    lastSeenAt: livePresence?.lastSeenAt ?? entry.lastSeen ?? 0,
                });
            }
            catch { /* skip malformed */ }
        }
        // Supplement: online players missing from the registry. Each save:<name>
        // is written atomically with its registry entry (save/[name].ts uses one
        // Promise.all for kv.set + kv.hset, and deletes both together), so the
        // registry already covers every saved player — the previous full
        // `keys('save:*')` directory walk added nothing in normal operation and
        // cost a recursive scan of the entire save tree on every (cache-miss)
        // call. The only players Block A above can miss are those online yet
        // absent from the registry: a brand-new character that hasn't saved yet,
        // or the rare window where a save's registry upsert lagged. We already
        // hold every live presence (no extra reads), so source the supplement
        // from there instead of scanning the save tree.
        const seen = new Set(players.map(p => p.name.toLowerCase()));
        for (const entry of presenceEntries) {
            const lname = entry.name.toLowerCase();
            if (seen.has(lname))
                continue;
            // Need character data to render the row (presence carries a trimmed
            // copy — same source Block A uses for online players).
            if (!entry.character)
                continue;
            seen.add(lname);
            const rawCharacter = entry.character;
            const character = rosterProjection(rawCharacter);
            players.push({
                name: rawCharacter.name ?? entry.name,
                level: rawCharacter.level ?? 1,
                village: rawCharacter.village ?? '',
                specialty: rawCharacter.specialty ?? '',
                online: true,
                character,
                currentSector: normalizeSector(entry.sector, 40),
                lastSeenAt: entry.lastSeenAt ?? 0,
            });
        }
        players.sort((a, b) => {
            if (a.online !== b.online)
                return a.online ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        // 60s CDN cache — the client only polls every 5 min anyway, and online status
        // is supplemented by the heartbeat, so 60s staleness here is invisible.
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=10');
        return res.status(200).json({ players });
    }
    catch (err) {
        console.error('[roster]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

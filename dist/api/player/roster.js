"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const REGISTRY_KEY = 'player:registry';
const PRESENCE_KEY_PREFIX = 'presence:';
const PRESENCE_TTL_MS = 65_000; // kept for belt-and-suspenders staleness check
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
    'inventory', 'tileCards', 'savedTileDeck',
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
function rosterProjection(character) {
    if (!character || typeof character !== 'object')
        return character;
    const src = character;
    const out = {};
    for (const [k, v] of Object.entries(src)) {
        if (ROSTER_STRIP_CHAR_FIELDS.has(k))
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
        // Read individual presence:<name> TTL keys written by heartbeat.ts.
        // kv.keys() only returns non-expired keys, so no manual TTL filter needed.
        const presenceKeys = await _storage_js_1.kv.keys(`${PRESENCE_KEY_PREFIX}*`);
        const presenceValues = presenceKeys.length > 0
            ? await _storage_js_1.kv.mget(...presenceKeys)
            : [];
        const now = Date.now();
        const presenceEntries = presenceValues.filter((v) => Boolean(v?.name) && now - (v.lastSeen ?? 0) <= PRESENCE_TTL_MS);
        const livePresenceByName = new Map(presenceEntries.map(entry => [entry.name.toLowerCase(), entry]));
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
                    lastSeenAt: livePresence?.lastSeen ?? entry.lastSeen ?? 0,
                });
            }
            catch { /* skip malformed */ }
        }
        // Supplement: any saves not yet in the registry — no extra get() calls needed,
        // just list their names so they show up; character data will arrive on next heartbeat.
        const saveKeysFull = await _storage_js_1.kv.keys('save:*');
        for (const key of saveKeysFull) {
            const name = key.replace('save:', '');
            if (players.some(p => p.name.toLowerCase() === name.toLowerCase()))
                continue;
            const livePresence = livePresenceByName.get(name.toLowerCase());
            // Only include if they have live presence (character data available without a save read).
            if (!livePresence?.character)
                continue;
            const rawCharacter = livePresence.character;
            const character = rosterProjection(rawCharacter);
            players.push({
                name: rawCharacter.name ?? name,
                level: rawCharacter.level ?? 1,
                village: rawCharacter.village ?? '',
                specialty: rawCharacter.specialty ?? '',
                online: true,
                character,
                currentSector: normalizeSector(livePresence.sector, 40),
                lastSeenAt: livePresence.lastSeen ?? 0,
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

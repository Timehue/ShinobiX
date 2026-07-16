"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const _elapsed_state_js_1 = require("../_elapsed-state.js");
const _public_index_js_1 = require("./_public-index.js");
const _public_index_store_js_1 = require("./_public-index-store.js");
const sleeper_camps_js_1 = require("../_realtime/sleeper-camps.js");
const travel_lease_js_1 = require("../_realtime/travel-lease.js");
const _proc_cache_js_1 = require("../_proc-cache.js");
const FULL_ROSTER_CACHE_KEY = 'player:roster:full';
const FULL_ROSTER_CACHE_TTL_MS = 60_000;
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
    // Battle Towers: strip the display ledgers, but SURFACE battleTowerBestFloor +
    // battleTowerRating (flat leaderboard stats, like rankedRating).
    'battleTowerClearedFloors', 'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed',
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
async function compactLeaderboardRoster(onlineNames) {
    const { entries } = await (0, _public_index_store_js_1.readPublicPlayerIndex)({ backfill: true, logContext: 'roster' });
    return [...entries.entries()]
        .filter(([key, entry]) => (0, _public_index_js_1.isPublicPlayerIndexKey)(key) && (0, _public_index_js_1.isPublicPlayerIndexKey)(entry.name))
        .map(([, entry]) => ((0, _public_index_js_1.publicIndexToLeaderboardRosterEntry)(entry, onlineNames.has((0, _public_index_js_1.publicIndexKey)(entry.name)))));
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
        if (req.query.leaderboards === '1') {
            const players = await compactLeaderboardRoster(onlineNames);
            res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=10');
            return res.status(200).json({ players });
        }
        // Railway serves this API from one long-lived process, so keep the
        // expensive all-save projection in the shared process cache. This
        // makes simultaneous public-roster polls join one in-flight mget and
        // reuses the finished snapshot for a minute instead of rescanning
        // every player save once per caller.
        const cachedPlayers = await (0, _proc_cache_js_1.cachedFor)(FULL_ROSTER_CACHE_KEY, FULL_ROSTER_CACHE_TTL_MS, async () => {
            // Primary: persistent registry (every player who ever connected)
            const [rawRegistry, sleeperCamps] = await Promise.all([
                _storage_js_1.kv.hgetall(_public_index_js_1.REGISTRY_KEY).then((value) => value ?? {}),
                (0, sleeper_camps_js_1.listSleeperCamps)(),
            ]);
            const registryKeys = Object.keys(rawRegistry);
            // Batch-fetch all saves in one command instead of N sequential kv.get() calls.
            const saveKeys = registryKeys.map(k => `save:${k}`);
            const travelLeaseKeys = registryKeys.map(travel_lease_js_1.travelLeaseKey);
            const [saves, battleLocks, rawTravelLeases] = saveKeys.length > 0
                ? await Promise.all([
                    _storage_js_1.kv.mget(...saveKeys),
                    (0, _elapsed_state_js_1.battleLockFlagsForPlayers)(registryKeys),
                    _storage_js_1.kv.mget(...travelLeaseKeys),
                ])
                : [[], new Map(), []];
            const players = [];
            const legacyCamps = [];
            const settledTravelLeaseNames = [];
            const campsToClear = [];
            const now = Date.now();
            for (let i = 0; i < registryKeys.length; i++) {
                const key = registryKeys[i];
                const value = rawRegistry[key];
                try {
                    const entry = typeof value === 'string' ? JSON.parse(value) : value;
                    const rawSave = saves[i] ?? null;
                    const save = rawSave
                        ? (0, _elapsed_state_js_1.settleSaveRecord)(rawSave, { battleLocked: battleLocks.get(key) === true }).record
                        : null;
                    const livePresence = livePresenceByName.get((entry.name ?? '').toLowerCase());
                    const slug = (0, _utils_js_1.safeName)(String(entry.name ?? key));
                    let sleeperCamp = livePresence ? undefined : sleeperCamps.get(slug);
                    const persistedTravel = (0, travel_lease_js_1.parseTravelLease)(rawTravelLeases[i]);
                    const travelSleeperSector = persistedTravel
                        ? (0, travel_lease_js_1.sleeperSectorForTravelLease)(persistedTravel, now)
                        : null;
                    const rawCharacter = livePresence?.character ?? save?.character;
                    const character = rosterProjection(rawCharacter);
                    // The Nindo creed + its banner preset live only in the full save,
                    // not the slim presence character preferred above for online
                    // players — graft them back so they show regardless of online
                    // status. Display-only; safe to surface publicly.
                    const fullChar = save?.character;
                    if (character && typeof character === 'object' && fullChar) {
                        for (const k of ['nindo', 'nindoBg']) {
                            const v = fullChar[k];
                            if (typeof v === 'string' && v)
                                character[k] = v;
                        }
                    }
                    const savedSector = normalizeSector(save?.currentSector, 0);
                    const fullCharacter = save?.character;
                    if (!livePresence && persistedTravel && travelSleeperSector === null) {
                        // A process restart must not let the legacy bridge remint an
                        // origin-sector camp while the authoritative lease is active.
                        if (sleeperCamp)
                            campsToClear.push(slug);
                        sleeperCamp = undefined;
                    }
                    if (!livePresence
                        && persistedTravel
                        && travelSleeperSector !== null
                        && fullCharacter
                        && fullCharacter.hospitalized !== true
                        && battleLocks.get(key) !== true) {
                        if (sleeperCamp?.sector !== travelSleeperSector) {
                            sleeperCamp = {
                                name: slug,
                                displayName: String(entry.name ?? slug),
                                sector: travelSleeperSector,
                                createdAt: now,
                            };
                            legacyCamps.push(sleeperCamp);
                        }
                        settledTravelLeaseNames.push(slug);
                    }
                    // One-time compatibility bridge for players who were already
                    // sleeping before explicit camp records shipped.
                    if (!livePresence && !sleeperCamp && !persistedTravel && savedSector >= 1 && fullCharacter && fullCharacter.hospitalized !== true && battleLocks.get(key) !== true) {
                        sleeperCamp = {
                            name: slug,
                            displayName: String(entry.name ?? slug),
                            sector: savedSector,
                            createdAt: Number(entry.lastSeen ?? Date.now()),
                        };
                        legacyCamps.push(sleeperCamp);
                    }
                    players.push({
                        name: entry.name ?? '',
                        level: entry.level ?? 1,
                        village: entry.village ?? '',
                        specialty: entry.specialty ?? '',
                        online: onlineNames.has((entry.name ?? '').toLowerCase()),
                        character,
                        currentSector: livePresence ? normalizeSector(livePresence.sector, 0) : (sleeperCamp?.sector ?? 0),
                        lastSeenAt: livePresence?.lastSeenAt ?? entry.lastSeen ?? 0,
                        sleeping: !livePresence && !!sleeperCamp,
                    });
                }
                catch { /* skip malformed */ }
            }
            if (legacyCamps.length) {
                await Promise.all(legacyCamps.map(sleeper_camps_js_1.setSleeperCamp));
                // A reconnect that lands while the compatibility/recovery writes are
                // in flight wins. Do not leave an attackable camp beside a live player.
                await Promise.all(legacyCamps.map(async (camp) => {
                    if (online_store_js_1.onlineStore.get(camp.name))
                        await (0, sleeper_camps_js_1.clearSleeperCamp)(camp.name);
                }));
            }
            if (settledTravelLeaseNames.length) {
                await (0, travel_lease_js_1.settleTravelLeases)(...settledTravelLeaseNames);
            }
            if (campsToClear.length) {
                await Promise.all(campsToClear.map(sleeper_camps_js_1.clearSleeperCamp));
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
            return players;
        });
        // The process cache owns the 60s freshness window. Keep the shared
        // edge TTL at one second so the total contract remains about the same
        // as the previous 60s edge-only policy instead of stacking two minutes.
        res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=10');
        return res.status(200).json({ players: cachedPlayers });
    }
    catch (err) {
        console.error('[roster]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

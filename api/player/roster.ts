import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { battleLockFlagsForPlayers, settleSaveRecord } from '../_elapsed-state.js';
import { REGISTRY_KEY, isPublicPlayerIndexKey, publicIndexKey, publicIndexToLeaderboardRosterEntry } from './_public-index.js';
import { readPublicPlayerIndex } from './_public-index-store.js';
import { clearSleeperCamp, listSleeperCamps, setSleeperCamp, type SleeperCamp } from '../_realtime/sleeper-camps.js';
import { parseTravelLease, settleTravelLeases, sleeperSectorForTravelLease, travelLeaseKey } from '../_realtime/travel-lease.js';
import { cachedFor } from '../_proc-cache.js';
import { earnedStatPoints } from '../_xp-engine.js';

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
const ROSTER_STRIP_CHAR_FIELDS = new Set<string>([
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
    'createdAt', 'professionChosenAt', 'professionRespecUsed',
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
const PET_PUBLIC_FIELDS = new Set<string>([
    'id', 'name', 'image', 'rarity', 'level', 'element', 'trait', 'species',
    'hp', 'attack', 'defense', 'speed',
    'jutsus', 'xp', 'unlockedForPve',
    'expedition',
]);
function projectPet(p: unknown): unknown {
    if (!p || typeof p !== 'object') return p;
    const src = p as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of PET_PUBLIC_FIELDS) if (k in src) out[k] = src[k];
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

function rosterProjection(character: unknown): unknown {
    if (!character || typeof character !== 'object') return character;
    const src = character as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
        if (ROSTER_STRIP_CHAR_FIELDS.has(k)) continue;
        // Belt-and-suspenders: drop anything that looks sensitive by name even
        // if it's not in the explicit strip list (future-field leak guard).
        if (ROSTER_SENSITIVE_NAME_RE.test(k)) continue;
        if (k === 'pets' && Array.isArray(v)) {
            out[k] = v.map(projectPet);
            continue;
        }
        out[k] = v;
    }
    // Character XP is retired (docs/leveling-without-xp-map.md): the stored
    // `xp` field is frozen ballast that nothing earns anymore, so shipping it
    // raw would make the Hall of Legends "Total Stat Points Earned" board rank
    // by dead pre-cutover numbers and show 0 for every character created since.
    // Serve the EARNED ledger in that slot instead — the same value the public
    // leaderboard index computes (api/player/_public-index.ts) — so the two
    // boards agree. Computed from the FULL character before `stats` is
    // stripped, so it leaks no stat block.
    out.xp = earnedStatPoints(src);
    return out;
}

type RosterPlayer = {
    name: string;
    level: number;
    village: string;
    specialty: string;
    online: boolean;
    character?: unknown;
    currentSector?: number;
    lastSeenAt?: number;
    sleeping?: boolean;
};

function normalizeSector(value: unknown, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return fallback;
    return Math.max(0, Math.floor(sector));
}

async function compactLeaderboardRoster(onlineNames: Set<string>) {
    const { entries } = await readPublicPlayerIndex({ backfill: true, logContext: 'roster' });
    return [...entries.entries()]
        .filter(([key, entry]) => isPublicPlayerIndexKey(key) && isPublicPlayerIndexKey(entry.name))
        .map(([, entry]) => (
            publicIndexToLeaderboardRosterEntry(entry, onlineNames.has(publicIndexKey(entry.name)))
        ));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Intentionally unauthenticated — StartScreen renders the public
    // leaderboard pre-login. The security boundary for this endpoint is
    // `rosterProjection` below, NOT an auth gate. Anything sensitive
    // (ryo, inventory, jutsu, stats, currencies, daily ledgers) MUST be
    // listed in ROSTER_STRIP_CHAR_FIELDS — and pet entries get their own
    // PET_PUBLIC_FIELDS whitelist before going out.

    try {
        // Live presence comes from the in-memory store (no DB scan). `name` is
        // already lowercased; `character` is the slim presence character.
        const presenceEntries = onlineStore.list();
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
        const cachedPlayers = await cachedFor<RosterPlayer[]>(
            FULL_ROSTER_CACHE_KEY,
            FULL_ROSTER_CACHE_TTL_MS,
            async () => {

        // Primary: persistent registry (every player who ever connected)
        const [rawRegistry, sleeperCamps] = await Promise.all([
            kv.hgetall<Record<string, string>>(REGISTRY_KEY).then((value) => value ?? {}),
            listSleeperCamps(),
        ]);
        const registryKeys = Object.keys(rawRegistry);

        // Batch-fetch all saves in one command instead of N sequential kv.get() calls.
        const saveKeys = registryKeys.map(k => `save:${k}`);
        const travelLeaseKeys = registryKeys.map(travelLeaseKey);
        const [saves, battleLocks, rawTravelLeases] = saveKeys.length > 0
            ? await Promise.all([
                kv.mget<Record<string, unknown>[]>(...saveKeys),
                battleLockFlagsForPlayers(registryKeys),
                kv.mget<unknown[]>(...travelLeaseKeys),
            ])
            : [[], new Map<string, boolean>(), []];

        const players: RosterPlayer[] = [];
        const legacyCamps: SleeperCamp[] = [];
        const settledTravelLeaseNames: string[] = [];
        const campsToClear: string[] = [];
        const now = Date.now();

        for (let i = 0; i < registryKeys.length; i++) {
            const key = registryKeys[i]!;
            const value = rawRegistry[key]!;
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                const rawSave = saves[i] ?? null;
                const save = rawSave
                    ? settleSaveRecord(rawSave, { battleLocked: battleLocks.get(key) === true }).record
                    : null;
                const livePresence = livePresenceByName.get((entry.name ?? '').toLowerCase());
                const slug = safeName(String(entry.name ?? key));
                let sleeperCamp = livePresence ? undefined : sleeperCamps.get(slug);
                const persistedTravel = parseTravelLease(rawTravelLeases[i]);
                const travelSleeperSector = persistedTravel
                    ? sleeperSectorForTravelLease(persistedTravel, now)
                    : null;
                const rawCharacter = livePresence?.character ?? save?.character;
                const character = rosterProjection(rawCharacter);
                // The Nindo creed + its banner preset live only in the full save,
                // not the slim presence character preferred above for online
                // players — graft them back so they show regardless of online
                // status. Display-only; safe to surface publicly.
                const fullChar = save?.character as Record<string, unknown> | undefined;
                if (character && typeof character === 'object' && fullChar) {
                    for (const k of ['nindo', 'nindoBg']) {
                        const v = fullChar[k];
                        if (typeof v === 'string' && v) (character as Record<string, unknown>)[k] = v;
                    }
                }
                const savedSector = normalizeSector(save?.currentSector, 0);
                const fullCharacter = save?.character as Record<string, unknown> | undefined;
                if (!livePresence && persistedTravel && travelSleeperSector === null) {
                    // A process restart must not let the legacy bridge remint an
                    // origin-sector camp while the authoritative lease is active.
                    if (sleeperCamp) campsToClear.push(slug);
                    sleeperCamp = undefined;
                }
                if (
                    !livePresence
                    && persistedTravel
                    && travelSleeperSector !== null
                    && fullCharacter
                    && fullCharacter.hospitalized !== true
                    && battleLocks.get(key) !== true
                ) {
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
            } catch { /* skip malformed */ }
        }

        if (legacyCamps.length) {
            await Promise.all(legacyCamps.map(setSleeperCamp));
            // A reconnect that lands while the compatibility/recovery writes are
            // in flight wins. Do not leave an attackable camp beside a live player.
            await Promise.all(legacyCamps.map(async (camp) => {
                if (onlineStore.get(camp.name)) await clearSleeperCamp(camp.name);
            }));
        }
        if (settledTravelLeaseNames.length) {
            await settleTravelLeases(...settledTravelLeaseNames);
        }
        if (campsToClear.length) {
            await Promise.all(campsToClear.map(clearSleeperCamp));
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
            if (seen.has(lname)) continue;
            // Need character data to render the row (presence carries a trimmed
            // copy — same source Block A uses for online players).
            if (!entry.character) continue;
            seen.add(lname);
            const rawCharacter = entry.character as Record<string, unknown>;
            const character = rosterProjection(rawCharacter) as Record<string, unknown>;
            players.push({
                name: (rawCharacter.name as string) ?? entry.name,
                level: (rawCharacter.level as number) ?? 1,
                village: (rawCharacter.village as string) ?? '',
                specialty: (rawCharacter.specialty as string) ?? '',
                online: true,
                character,
                currentSector: normalizeSector(entry.sector, 40),
                lastSeenAt: entry.lastSeenAt ?? 0,
            });
        }

        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

                return players;
            },
        );

        // Two caches sit in front of this: the 60s process cache above (which owns the
        // expensive all-save projection AND bakes in the online flags) and the shared
        // edge cache here.
        //
        // The edge TTL was 1s, chosen so the two wouldn't "stack" to two minutes of
        // staleness. The cost of that choice was that essentially every client poll
        // reached the origin — 150+ players polling once a minute, each forcing a
        // re-serialise and re-gzip of the whole roster on a single-threaded process.
        //
        // 30s is the compromise: worst-case staleness is 90s instead of 120s, while the
        // edge now absorbs most polls. This response is a player DIRECTORY (names,
        // levels, villages, an online dot) — live sector positions come from the
        // presence socket, not from here — so tens of seconds of staleness is not
        // player-visible. `stale-while-revalidate` keeps the edge serving instantly
        // while it refreshes in the background.
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=30');
        return res.status(200).json({ players: cachedPlayers });
    } catch (err) {
        console.error('[roster]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

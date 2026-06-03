"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_TRAVEL_WINDOW_MS = void 0;
exports.normalizeSector = normalizeSector;
exports.capTravelingUntil = capTravelingUntil;
exports.slimPresenceCharacter = slimPresenceCharacter;
exports.toPlayerRecord = toPlayerRecord;
// Max time the client can claim to be traveling (10 min). Caps an exploited
// travelingUntil that would make a player permanently unreachable.
exports.MAX_TRAVEL_WINDOW_MS = 10 * 60_000;
function normalizeSector(value, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector))
        return fallback;
    return Math.max(0, Math.floor(sector));
}
// Cap client-supplied travelingUntil so an exploit can't make a player
// permanently untouchable (e.g. client sends year-9999 epoch). Returns the
// capped value only when it's still in the future, else undefined.
function capTravelingUntil(travelingUntil, now) {
    if (!travelingUntil)
        return undefined;
    const capped = Math.min(travelingUntil, now + exports.MAX_TRAVEL_WINDOW_MS);
    return capped > now ? capped : undefined;
}
// Server-side defense-in-depth: project the incoming character down to the
// display fields the presence row is actually read for (roster + `pets` for Pet
// Arena challenges) BEFORE storing it. The current client already slims this,
// but an old or hostile client could still POST the full multi-MB blob (avatar
// data URL, inventory, jutsu, …). Slimming here keeps the presence row — and
// the roster reads — small regardless of what the client sends. Gameplay/PvP
// paths never read this character (they read sector/inBattle/travelingUntil/
// pendingAttacker and hydrate from save:<name>), so trimming cannot affect
// battle or PvP behavior.
const PRESENCE_CHAR_KEEP = new Set([
    'name', 'level', 'village', 'specialty', 'rank', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'professionXp', 'rankedRating', 'petRankedRating',
    'clan', 'clanFounder', 'hp', 'maxHp',
]);
const PRESENCE_PET_KEEP = new Set([
    'id', 'name', 'image', 'rarity', 'level', 'element', 'trait', 'species',
    'hp', 'attack', 'defense', 'speed', 'jutsus', 'xp', 'unlockedForPve', 'expedition',
]);
function slimPresenceCharacter(input) {
    if (!input || typeof input !== 'object')
        return null;
    const src = input;
    const out = {};
    for (const k of PRESENCE_CHAR_KEEP)
        if (k in src)
            out[k] = src[k];
    if (Array.isArray(src.pets)) {
        out.pets = src.pets.map((p) => {
            if (!p || typeof p !== 'object')
                return p;
            const ps = p;
            const pet = {};
            for (const f of PRESENCE_PET_KEEP)
                if (f in ps)
                    pet[f] = ps[f];
            return pet;
        });
    }
    return out;
}
/**
 * Project a stored OnlinePlayer into the PlayerRecord shape the client renders
 * (liveSectorPlayers / playerRoster). Avatar image is intentionally omitted —
 * the client resolves avatars from its name-keyed cache; shipping the base64
 * blob on every presence frame was the single largest egress cost.
 */
function toPlayerRecord(p) {
    const ch = p.character;
    return {
        name: p.displayName,
        sector: p.sector,
        character: { avatarImage: '' },
        level: ch?.level ?? 1,
        village: ch?.village ?? '',
        specialty: ch?.specialty ?? 'Ninjutsu',
        currentSector: p.sector,
        lastSeenAt: p.lastSeenAt,
        travelingUntil: p.travelingUntil ?? 0,
        inBattle: p.inBattle ?? false,
    };
}

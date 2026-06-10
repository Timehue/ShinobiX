/**
 * Pure helpers for turning a raw heartbeat / WS-ping body into safe presence
 * fields, and for projecting a stored OnlinePlayer back into the PlayerRecord
 * shape the client expects.
 *
 * Extracted from api/player/heartbeat.ts so the HTTP heartbeat path and the
 * Socket.IO presence path slim/cap/shape presence IDENTICALLY — a divergence
 * here would let one path store a fat character (egress + memory blowup) or
 * an uncapped travelingUntil (permanent untouchability). Keep both paths on
 * these functions.
 */
import type { OnlinePlayer } from './types.js';

// Max time the client can claim to be traveling (10 min). Caps an exploited
// travelingUntil that would make a player permanently unreachable.
export const MAX_TRAVEL_WINDOW_MS = 10 * 60_000;

export function normalizeSector(value: unknown, fallback = 40): number {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return fallback;
    return Math.max(0, Math.floor(sector));
}

// Cap client-supplied travelingUntil so an exploit can't make a player
// permanently untouchable (e.g. client sends year-9999 epoch). Returns the
// capped value only when it's still in the future, else undefined.
export function capTravelingUntil(travelingUntil: number | undefined, now: number): number | undefined {
    if (!travelingUntil) return undefined;
    const capped = Math.min(travelingUntil, now + MAX_TRAVEL_WINDOW_MS);
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
const PRESENCE_CHAR_KEEP = new Set<string>([
    'name', 'level', 'village', 'specialty', 'rank', 'rankTitle', 'customTitle',
    'profession', 'professionRank', 'professionXp', 'rankedRating', 'petRankedRating',
    'clan', 'clanFounder', 'hp', 'maxHp',
]);
// pet `image` is intentionally dropped (mirrors the client's PRESENCE_PET_FIELDS
// in App.tsx): every pet render site resolves the sprite from the viewer's own
// sharedImages['pet:<id>'|'pet:<base>'] cache, so the data URL on the presence
// row was redundant and bloated the per-second frame. Stats/jutsus stay so the
// pet battle sim is unaffected. Keep this list in sync with PRESENCE_PET_FIELDS.
const PRESENCE_PET_KEEP = new Set<string>([
    'id', 'name', 'rarity', 'level', 'element', 'trait', 'species',
    'hp', 'attack', 'defense', 'speed', 'jutsus', 'xp', 'unlockedForPve', 'expedition',
]);

export function slimPresenceCharacter(input: unknown): Record<string, unknown> | null {
    if (!input || typeof input !== 'object') return null;
    const src = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of PRESENCE_CHAR_KEEP) if (k in src) out[k] = src[k];
    if (Array.isArray(src.pets)) {
        out.pets = src.pets.map((p) => {
            if (!p || typeof p !== 'object') return p;
            const ps = p as Record<string, unknown>;
            const pet: Record<string, unknown> = {};
            for (const f of PRESENCE_PET_KEEP) if (f in ps) pet[f] = ps[f];
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
export function toPlayerRecord(p: OnlinePlayer) {
    const ch = p.character as Record<string, unknown> | null;
    return {
        name: p.displayName,
        sector: p.sector,
        character: { avatarImage: '' },
        level: ch?.level ?? 1,
        village: ch?.village ?? '',
        // clan is kept in the slim presence character (PRESENCE_CHAR_KEEP); surfaced
        // here so the Scout Network clan-war world-map overlay can spot enemy-clan
        // members. Clan membership is already public, so this exposes nothing new.
        clan: ch?.clan ?? '',
        specialty: ch?.specialty ?? 'Ninjutsu',
        currentSector: p.sector,
        lastSeenAt: p.lastSeenAt,
        travelingUntil: p.travelingUntil ?? 0,
        inBattle: p.inBattle ?? false,
    };
}

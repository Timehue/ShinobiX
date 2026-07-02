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
import { sanitizeUserText, hasReservedTitleTerm, TEXT_LIMITS } from '../_text-moderation.js';
import { TITLE_STYLE_IDS, TITLE_ICON_SET } from '../_titles-registry.js';
import { LEGACY_BY_ID } from '../_legacy-defs.js';

// Max time the client can claim to be traveling (10 min). Caps an exploited
// travelingUntil that would make a player permanently unreachable.
export const MAX_TRAVEL_WINDOW_MS = 10 * 60_000;

export function normalizeSector(value: unknown, fallback = 40): number {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return fallback;
    return Math.max(0, Math.floor(sector));
}

// Within-sector tile index (the 12x12 grid → 0..143) for live peer rendering.
// Clamped to range; returns `fallback` (default undefined) when the client sent
// nothing parseable, so an older client without a tile degrades gracefully (the
// viewer falls back to a deterministic per-name tile). Display-only: no gameplay
// path reads tile, so a bogus value can only mis-place a cosmetic marker.
export function normalizeTile(value: unknown, fallback?: number): number | undefined {
    const tile = Number(value);
    if (!Number.isFinite(tile)) return fallback;
    return Math.max(0, Math.min(143, Math.floor(tile)));
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
    'customTitleStyle', 'customTitleIcon', 'legacy',
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
    // Public-roster defense: the presence blob is client-supplied and shown to
    // every player, so its customTitle would otherwise bypass the save
    // sanitizer entirely (verification finding: a hostile client could show
    // "Admin" to all). Cheap always-on impersonation/profanity scrub — display
    // only, never touches the save. Earned-title ownership isn't checkable here
    // (no save read on the hot path), but the authority-impersonation cases are.
    if (typeof out.customTitle === 'string' && out.customTitle) {
        const cleaned = sanitizeUserText(out.customTitle, TEXT_LIMITS.customTitle);
        out.customTitle = hasReservedTitleTerm(cleaned) ? '' : cleaned;
    } else if (out.customTitle !== undefined && typeof out.customTitle !== 'string') {
        delete out.customTitle;
    }
    // Title cosmetics ride the presence frame so other players see the paid
    // style/icon (roster, sector chips). Same public-display defense as
    // customTitle: allowlist-clamped here, so a hostile client can't broadcast
    // arbitrary strings through the fields.
    if ('customTitleStyle' in out && (typeof out.customTitleStyle !== 'string' || !TITLE_STYLE_IDS.has(out.customTitleStyle))) {
        delete out.customTitleStyle;
    }
    if ('customTitleIcon' in out && (typeof out.customTitleIcon !== 'string' || !TITLE_ICON_SET.has(out.customTitleIcon))) {
        delete out.customTitleIcon;
    }
    // Legacy prestige chip (roster/UserView). Projected down to the two display
    // fields, gated on the server flag (nobody can broadcast a legacy while the
    // system is off), and the id validated against the real roster; display-
    // only, same client-claim trust level as presence level/rank/customTitle —
    // the SAVE copy (server-owned, sanitizer-reinjected) stays the source of
    // truth everywhere it matters. Env read inline: importing legacyEnabled()
    // would pull the KV layer into this pure, hot-path module.
    if ('legacy' in out) {
        const lg = out.legacy as Record<string, unknown> | null;
        const stage = Number(lg?.stage);
        if (process.env.ENABLE_LEGACY === '1'
            && lg && typeof lg === 'object'
            && typeof lg.legacyId === 'string' && LEGACY_BY_ID.has(lg.legacyId)
            && Number.isInteger(stage) && stage >= 1 && stage <= 5) {
            out.legacy = { legacyId: lg.legacyId, stage };
        } else {
            delete out.legacy;
        }
    }
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
        // Within-sector tile for live peer rendering (omitted → viewer falls back
        // to a deterministic per-name tile). Display-only.
        tile: p.tile,
    };
}

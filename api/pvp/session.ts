import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';

export type PvpStatus = {
    name: string;
    rounds: number;
    activeRound?: number;
    percent?: number;
    amount?: number;
    kind: 'positive' | 'negative';
};

export type PvpFighter = {
    name: string;
    hp: number;
    maxHp: number;
    chakra: number;
    maxChakra: number;
    stamina: number;
    maxStamina: number;
    shield: number;
    statuses: PvpStatus[];
    character: Record<string, unknown>;
    pos: number; // hex grid position (0–119 for 12×10 grid)
};

export type PvpGroundEffect = {
    id: string;
    owner: 'p1' | 'p2';
    name: string;
    tiles: number[];
    rounds: number;
    tags: Array<{ name: string; percent?: number; amount?: number }>;
};

export type PvpSession = {
    battleId: string;
    p1: PvpFighter;
    p2: PvpFighter;
    round: number;
    activePlayer: 'p1' | 'p2'; // whose turn it is
    ap: { p1: number; p2: number };
    actionsThisTurn: number;
    cooldowns: { p1: Record<string, number>; p2: Record<string, number> };
    groundEffects?: PvpGroundEffect[];
    log: string[];
    status: 'active' | 'done';
    winner: 'p1' | 'p2' | 'draw' | null;
    fleedBy?: 'p1' | 'p2';
    createdAt: number;
    // Stamped every time a successful move commits. Used as a crashed-tab
    // fallback by the 'claim-afk-win' action — if the active player hasn't
    // moved in 90s the inactive player can claim the win even if the
    // round-timer never fired.
    lastMoveAt?: number;
    // Consecutive auto-waited (timer-expired) turns per player where the
    // player took ZERO real actions. Resets to 0 on any non-auto action.
    // claim-afk-win succeeds when opponent's count reaches 2 — i.e., they
    // let the 45s round timer run out twice in a row without doing anything.
    consecAutoWait?: { p1?: number; p2?: number };
    // Environment snapshot captured at create time. /api/pvp/move reads
    // these from the session instead of trusting the request body — stops
    // clients from changing biome / weather between rounds.
    biome?: string;
    weatherPositiveElement?: string;
    weatherNegativeElement?: string;
    // Idempotency for move retries. Client generates a per-move UUID
    // and includes it in every POST /api/pvp/move. Server appends to
    // this ring buffer (capped at PVP_MOVE_TOKEN_HISTORY) after a
    // successful move. A retry that arrives with a token already in
    // the list short-circuits with the current session state instead
    // of re-applying the move.
    recentMoveTokens?: string[];
};
export const PVP_MOVE_TOKEN_HISTORY = 20;

// Shorter TTL than the 60-min ceiling — most PvP matches finish in 5-15
// minutes, so a 15-min TTL covers the live fight plus a buffer for the
// claim flow. Each move/state action via `move.ts` refreshes the TTL via
// `writeSession`, so an actively-played match never expires; only
// abandoned sessions (a tab closed mid-fight) decay. Keeps KV usage
// proportional to actual live matches instead of accumulating an hour
// of stale rows per started fight.
const SESSION_TTL = 15 * 60;
// Cap the combat log at the last N lines. Without this the log grows
// unbounded over a long fight (typical: 1-3 lines per move × 30+
// moves = 50+ KB of payload that both clients re-download every
// state poll). Recent context is what matters; historians can scroll
// the live ticker, but the wire payload stays small.
export const PVP_LOG_MAX_LINES = 60;
export function trimPvpLog(log: string[]): string[] {
    if (log.length <= PVP_LOG_MAX_LINES) return log;
    const dropped = log.length - PVP_LOG_MAX_LINES + 1;
    return [`… (${dropped} earlier lines trimmed)`, ...log.slice(-PVP_LOG_MAX_LINES + 1)];
}

// Starting positions matching arena (p1 left side, p2 right side)
const P1_START = 62;
const P2_START = 33;

// ─── Server-side sanitization of client-supplied combat data ─────────────────
// Even with auth, the player can hand-edit their localStorage / save blob, so
// the server clamps everything that matters for damage calculation to safe
// defensive bounds before the session is sealed.

function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
}

// Acceptable jutsu-tag names. Anything else is filtered out at session
// hydration time so a poisoned save (or NPC payload) cannot inject novel
// tag names that the move handler doesn't recognize but might still apply.
// Keep this in sync with the tag handler switch in api/pvp/move.ts.
const KNOWN_TAG_NAMES: ReadonlySet<string> = new Set([
    'Heal', 'Shield', 'Barrier', 'Pierce', 'Stun', 'Poison', 'Drain', 'Absorb', 'Reflect',
    'Lifesteal', 'Increase Damage Given', 'Decrease Damage Given', 'Increase Damage Taken',
    'Decrease Damage Taken', 'Increase Heal', 'Debuff Prevent', 'Buff Prevent',
    'Cleanse Prevent', 'Clear Prevent', 'Stun Prevent', 'Copy', 'Mirror', 'Push', 'Pull',
    'Bloodline Seal', 'Seal', 'Elemental Seal', 'Wound', 'Recoil', 'Move',
    // tag aliases that the move handler normalizes:
    'Afterburn', 'Ignition', 'Time Compression', 'Lag', 'Time Dilation', 'Overclock',
    'Vamp', 'Siphon',
]);

export function sanitizeJutsuList(rawList: unknown): unknown[] {
    if (!Array.isArray(rawList)) return [];
    // v4.3 Pierce rules: enforce ap=60 on any Pierce jutsu, and only ONE Pierce per loadout.
    let piercesSeen = 0;
    return rawList
        .filter((j): j is Record<string, unknown> => !!j && typeof j === 'object')
        .map((j) => {
            const out: Record<string, unknown> = { ...j };
            // Hard caps so a tampered jutsu can't supply an instant-kill effect.
            out.effectPower = clampNumber(out.effectPower, 0, 600, 0);
            if (out.ap != null) out.ap = clampNumber(out.ap, 0, 200, 40);
            if (out.cooldown != null) out.cooldown = clampNumber(out.cooldown, 0, 50, 0);
            if (out.chakraCost != null) out.chakraCost = clampNumber(out.chakraCost, 0, 1000, 0);
            if (out.staminaCost != null) out.staminaCost = clampNumber(out.staminaCost, 0, 1000, 0);
            if (out.range != null) out.range = clampNumber(out.range, 0, 30, 1);
            // Filter and cap tag list — at most 10 known tags per jutsu.
            const rawTags = Array.isArray(out.tags) ? out.tags : [];
            let cleanTags = (rawTags as unknown[])
                .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
                .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                .slice(0, 10);
            // v4.3 Pierce: at most one Pierce per loadout; subsequent Pierces are stripped.
            // Pierce jutsu AP is forced to 60.
            const hasPierce = cleanTags.some(t => t.name === 'Pierce');
            if (hasPierce) {
                if (piercesSeen >= 1) {
                    cleanTags = cleanTags.filter(t => t.name !== 'Pierce');
                } else {
                    piercesSeen += 1;
                    out.ap = 60;
                }
            }
            out.tags = cleanTags;
            return out;
        });
}

function sanitizePvpItems(raw: unknown): unknown[] {
    if (!Array.isArray(raw)) return [];
    return raw.filter((i) => !!i && typeof i === 'object');
}

// Fields STRIPPED from the character before it's sealed into the PvP
// session record. The session is then exposed via /api/pvp/session GET
// + /api/pvp/stream (both unauthenticated for spectator/EventSource
// compatibility), so anything not strictly needed for combat resolution
// is a leak surface. Combat needs: stats, jutsu, pvpItems, equipment,
// bloodlines/armor multipliers, specialty, name/level/village/avatar.
// It does NOT need: ryo / bankRyo / honorSeals / fateShards / boneCharms
// / mythicSeals / auraStones / auraDust, inventory, daily ledgers,
// mission journals, achievement state, creator content.
const SESSION_STRIP_CHAR_FIELDS = new Set<string>([
    // Currencies
    'ryo', 'bankRyo', 'honorSeals', 'fateShards', 'boneCharms',
    'auraStones', 'mythicSeals', 'auraDust',
    // Non-combat inventory (pvpItems and equipment ARE used by combat)
    'inventory', 'tileCards', 'savedTileDeck',
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
    // Lifetime counters (not needed mid-fight; UI reads them from save endpoint)
    'totalPvpKills', 'monthlyPvpKills', 'pvpKillMonth',
    'totalAiKills', 'totalVillageRaids',
    'totalPetWins', 'totalEndlessTowerWins', 'totalTilesExplored',
    'totalTournamentsCompleted', 'warsWon', 'warMvpCount', 'lifetimeWarDamage',
    'unlockedAchievements', 'achievementUnlockedAt',
    // Run state for solo modes
    'hollowGateRun', 'hollowGateWardenKills', 'hollowGateIntroSeen',
    'endlessTowerRun', 'endlessTowerBestWave',
    'weeklyBossKills', 'claimedWarCrateIds',
    'villageWarMissionDate', 'villageWarRaidProgress', 'villageWarMissionsCompleted',
    'clanBattleContrib', 'clanEventContrib', 'clanMissionContrib', 'clanContribMonth',
    'petEscortBonusReady', 'hunterRank',
    'lastBankInterestAt',
    'creatorAis', 'creatorEvents', 'creatorMissions', 'creatorRaids', 'creatorCards',
    'defeatedAiIds', 'elderFocus', 'examsPassed',
    'triggeredEvents',
    // Story-only persistence
    'storyTraits', 'storyTitle', 'storyProgress',
    // Pets are huge and not needed for a 1v1 PvP fight
    'pets', 'editablePets',
]);
function stripNonCombatFields(character: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(character)) {
        if (SESSION_STRIP_CHAR_FIELDS.has(k)) continue;
        out[k] = v;
    }
    return out;
}

// Hydrate a fighter character from the authoritative save. The client payload
// is only used as a fallback for fields the save lacks (e.g. computed
// bloodlineMult on NPCs without a save).
function hydrateCharacterFromSave(saveCharacter: Record<string, unknown>, clientCharacter: Record<string, unknown>): Record<string, unknown> {
    // Start with the save (server is authority for HP, level, stats, etc.).
    const merged: Record<string, unknown> = { ...saveCharacter };
    // For derived fields the client computes, fall back to the client value
    // only when the save doesn't have a usable value. All within safe bounds.
    const pickClamped = (saveVal: unknown, clientVal: unknown, min: number, max: number, fb: number) => {
        if (saveVal != null && Number.isFinite(Number(saveVal))) return clampNumber(saveVal, min, max, fb);
        return clampNumber(clientVal, min, max, fb);
    };
    merged.bloodlineMult = pickClamped(saveCharacter.bloodlineMult, clientCharacter.bloodlineMult, 1.0, 3.0, 1.0);
    merged.armorFactor = pickClamped(saveCharacter.armorFactor, clientCharacter.armorFactor, 0.25, 1.0, 1.0);
    merged.armorRawDR = pickClamped(saveCharacter.armorRawDR, clientCharacter.armorRawDR, 0, 1.5, 0);
    merged.itemDamagePct = pickClamped(saveCharacter.itemDamagePct, clientCharacter.itemDamagePct, 0, 200, 0);
    // Sanitize loadout fields (jutsu list, pvpItems) — these ARE persisted.
    merged.jutsu = sanitizeJutsuList(saveCharacter.jutsu ?? clientCharacter.jutsu);
    merged.pvpItems = sanitizePvpItems(saveCharacter.pvpItems ?? clientCharacter.pvpItems);
    // Strip everything that isn't combat-relevant. The session is read by
    // spectators (and by the unauth /api/pvp/stream endpoint) so anything
    // sensitive (ryo, currencies, inventory, journals) would leak otherwise.
    return stripNonCombatFields(merged);
}

// For NPC opponents (no save key in KV), we still clamp the client payload
// rather than trusting it as-is — caller already restricted this path to
// arena PvP-vs-AI flows that don't persist.
function hydrateNpcCharacter(clientCharacter: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...clientCharacter };
    out.bloodlineMult = clampNumber(out.bloodlineMult, 1.0, 3.0, 1.0);
    out.armorFactor = clampNumber(out.armorFactor, 0.25, 1.0, 1.0);
    out.armorRawDR = clampNumber(out.armorRawDR, 0, 1.5, 0);
    out.itemDamagePct = clampNumber(out.itemDamagePct, 0, 200, 0);
    out.jutsu = sanitizeJutsuList(out.jutsu);
    out.pvpItems = sanitizePvpItems(out.pvpItems);
    // Same strip as real characters — NPCs can have arbitrary client-
    // supplied fields and we don't want any of the sensitive ones to land
    // in the session record either.
    return stripNonCombatFields(out);
}

function makeFighter(char: Record<string, unknown>, pos: number): PvpFighter {
    const maxHp = Number((char.maxHp as number) ?? 100);
    const maxChakra = Number((char.maxChakra as number) ?? 50);
    const maxStamina = Number((char.maxStamina as number) ?? 50);
    return {
        name: (char.name as string) ?? 'Unknown',
        hp: Math.min(Number((char.hp as number) ?? maxHp), maxHp),
        maxHp,
        chakra: Math.min(Number((char.chakra as number) ?? maxChakra), maxChakra),
        maxChakra,
        stamina: Math.min(Number((char.stamina as number) ?? maxStamina), maxStamina),
        maxStamina,
        shield: 0,
        statuses: [],
        character: char,
        pos,
    };
}

const VALID_BIOMES = new Set(['forest', 'snow', 'volcano', 'shadow', 'central']);
const VALID_ELEMENTS = new Set(['', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang']);
function normalizeBiome(b: unknown): string {
    if (typeof b === 'string' && VALID_BIOMES.has(b)) return b;
    return 'central';
}
function normalizeElement(e: unknown): string {
    if (typeof e === 'string' && VALID_ELEMENTS.has(e)) return e;
    return '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        // Poll endpoint — clients hit this every ~1s while the battle screen
        // is open. Generous budget per IP so two players + spectators can
        // share an IP, but block obvious abuse (≥10 polls/sec sustained).
        if (!(await enforceRateLimitKv(req, res, 'pvp-session-get', 360, 60_000))) return;
        const battleId = String(req.query.id ?? '');
        if (!battleId) return res.status(400).json({ error: 'Missing id' });
        const session = await kv.get<PvpSession>(`pvp:${battleId}`);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        // Never cache battle state — both fighters poll every ~1s and need fresh data
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(session);
    }

    if (req.method === 'POST') {
        // Require a logged-in player. The creator must be one of the two
        // fighters (or admin) — otherwise anyone could fabricate a PvP session
        // with arbitrary stats (e.g. 999999 HP god mode).
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Cap session creation. A legit player starts a duel maybe every
        // 30s in heavy play; 6/min is comfortable headroom and stops
        // KV-fill attacks that spam-create sessions. Admins skip the cap
        // (testing scripts may legitimately create many sessions fast).
        const rlName = identity.admin ? undefined : identity.name;
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pvp-session-create', 6, 60_000, rlName))) return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character, biome, weatherPositiveElement, weatherNegativeElement, battleId: clientBattleId } = body as {
                p1Character?: Record<string, unknown>;
                p2Character?: Record<string, unknown>;
                biome?: string;
                weatherPositiveElement?: string;
                weatherNegativeElement?: string;
                battleId?: string;
            };
            if (!p1Character || !p2Character) return res.status(400).json({ error: 'Missing characters' });

            const p1Name = (p1Character.name as string) ?? 'Player 1';
            const p2Name = (p2Character.name as string) ?? 'Player 2';

            const p1Norm = String(p1Name).trim().toLowerCase();
            const p2Norm = String(p2Name).trim().toLowerCase();

            if (!identity.admin) {
                const me = identity.name;
                if (me !== p1Norm && me !== p2Norm) {
                    return res.status(403).json({ error: 'Can only create sessions you are a fighter in.' });
                }
            }

            // ── Hydrate both fighters from authoritative saves ───────────────
            // The creator only really supplies the names (and an NPC payload
            // for AI fights). We load each fighter's persisted save and pull
            // jutsu / pvpItems / armor / bloodlineMult / itemDamagePct from
            // there. The client's character body is only consulted as a
            // fallback for fighters who don't have a save record (NPCs).
            // Admins keep their override path (admin acts as anyone for tests).
            let finalP1Character: Record<string, unknown>;
            let finalP2Character: Record<string, unknown>;

            const [p1Save, p2Save] = await Promise.all([
                p1Norm ? kv.get<Record<string, unknown>>(`save:${p1Norm}`) : Promise.resolve(null),
                p2Norm ? kv.get<Record<string, unknown>>(`save:${p2Norm}`) : Promise.resolve(null),
            ]);

            if (p1Save?.character) {
                finalP1Character = hydrateCharacterFromSave(p1Save.character as Record<string, unknown>, p1Character);
            } else if (identity.admin) {
                finalP1Character = hydrateNpcCharacter(p1Character);
            } else if (identity.name === p1Norm) {
                return res.status(400).json({ error: 'Your character save was not found on the server.' });
            } else {
                // Opponent has no save → NPC. Clamp client payload defensively.
                finalP1Character = hydrateNpcCharacter(p1Character);
            }

            if (p2Save?.character) {
                finalP2Character = hydrateCharacterFromSave(p2Save.character as Record<string, unknown>, p2Character);
            } else if (identity.admin) {
                finalP2Character = hydrateNpcCharacter(p2Character);
            } else if (identity.name === p2Norm) {
                return res.status(400).json({ error: 'Your character save was not found on the server.' });
            } else {
                finalP2Character = hydrateNpcCharacter(p2Character);
            }

            // Server-generated battleId. We used to accept a client-supplied
            // id (for optimistic navigation) — but that let an attacker
            // pre-claim guessable ids to later scrape via /api/pvp/stream
            // (which is unauth by design for EventSource compat). Server-only
            // ids close that scrape vector. The client just waits the ~50ms
            // round trip for the id before navigating; UX impact is invisible.
            void clientBattleId; // intentionally ignored
            const battleId = `pvp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

            // True 50/50 coin flip — going first is a meaningful turn-based
            // advantage and previously the attacker (always p1) won by default.
            // Now both sides have an equal shot at the opening move; the
            // prefight overlay's "X goes first!" reveal matches the server roll.
            const firstActor: 'p1' | 'p2' = Math.random() < 0.5 ? 'p1' : 'p2';
            const firstActorName = firstActor === 'p1' ? p1Name : p2Name;
            const session: PvpSession = {
                battleId,
                p1: makeFighter(finalP1Character, P1_START),
                p2: makeFighter(finalP2Character, P2_START),
                round: 1,
                activePlayer: firstActor,
                ap: { p1: 100, p2: 100 },
                actionsThisTurn: 0,
                cooldowns: { p1: {}, p2: {} },
                log: [`⚔️ ${p1Name} vs ${p2Name} — Battle begins! 🪙 ${firstActorName} wins the coin flip and goes first.`],
                status: 'active',
                winner: null,
                createdAt: Date.now(),
                lastMoveAt: Date.now(),
                // Snapshot environment so /api/pvp/move can't be tricked into
                // applying a different biome / weather mid-fight.
                biome: normalizeBiome(biome),
                weatherPositiveElement: normalizeElement(weatherPositiveElement),
                weatherNegativeElement: normalizeElement(weatherNegativeElement),
            };

            await kv.set(`pvp:${battleId}`, session, { ex: SESSION_TTL });
            return res.status(200).json({ battleId });
        } catch (err) {
            console.error('[pvp/session]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVP_LOG_MAX_LINES = exports.PVP_MOVE_TOKEN_HISTORY = void 0;
exports.trimPvpLog = trimPvpLog;
exports.sanitizeJutsuList = sanitizeJutsuList;
exports.sanitizePvpItems = sanitizePvpItems;
exports.stripNonCombatFields = stripNonCombatFields;
exports.default = handler;
const crypto_1 = require("crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const presence_gating_js_1 = require("../_realtime/presence-gating.js");
exports.PVP_MOVE_TOKEN_HISTORY = 20;
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
exports.PVP_LOG_MAX_LINES = 60;
function trimPvpLog(log) {
    if (log.length <= exports.PVP_LOG_MAX_LINES)
        return log;
    const dropped = log.length - exports.PVP_LOG_MAX_LINES + 1;
    return [`… (${dropped} earlier lines trimmed)`, ...log.slice(-exports.PVP_LOG_MAX_LINES + 1)];
}
// Starting positions matching arena (p1 left side, p2 right side)
const P1_START = 62;
const P2_START = 33;
// ─── Server-side sanitization of client-supplied combat data ─────────────────
// Even with auth, the player can hand-edit their localStorage / save blob, so
// the server clamps everything that matters for damage calculation to safe
// defensive bounds before the session is sealed.
function clampNumber(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v))
        return fallback;
    return Math.min(max, Math.max(min, v));
}
// Acceptable jutsu-tag names. Anything else is filtered out at session
// hydration time so a poisoned save (or NPC payload) cannot inject novel
// tag names that the move handler doesn't recognize but might still apply.
// Keep this in sync with the tag handler switch in api/pvp/move.ts.
const KNOWN_TAG_NAMES = new Set([
    'Heal', 'Shield', 'Barrier', 'Pierce', 'Stun', 'Poison', 'Drain', 'Absorb', 'Reflect',
    'Lifesteal', 'Increase Damage Given', 'Decrease Damage Given', 'Increase Damage Taken',
    'Decrease Damage Taken', 'Increase Heal', 'Debuff Prevent', 'Buff Prevent',
    'Cleanse Prevent', 'Clear Prevent', 'Stun Prevent', 'Copy', 'Mirror', 'Push', 'Pull',
    'Bloodline Seal', 'Seal', 'Elemental Seal', 'Wound', 'Recoil', 'Move',
    // tag aliases that the move handler normalizes:
    'Afterburn', 'Ignition', 'Time Compression', 'Lag', 'Time Dilation', 'Overclock',
    'Vamp', 'Siphon',
]);
function sanitizeJutsuList(rawList) {
    if (!Array.isArray(rawList))
        return [];
    // v4.3 Pierce rules: enforce ap=60 on any Pierce jutsu, and only ONE Pierce per loadout.
    let piercesSeen = 0;
    return rawList
        .filter((j) => !!j && typeof j === 'object')
        .map((j) => {
        const out = { ...j };
        // Hard caps so a tampered jutsu can't supply an instant-kill effect.
        out.effectPower = clampNumber(out.effectPower, 0, 600, 0);
        if (out.ap != null)
            out.ap = clampNumber(out.ap, 0, 200, 40);
        if (out.cooldown != null)
            out.cooldown = clampNumber(out.cooldown, 0, 50, 0);
        if (out.chakraCost != null)
            out.chakraCost = clampNumber(out.chakraCost, 0, 1000, 0);
        if (out.staminaCost != null)
            out.staminaCost = clampNumber(out.staminaCost, 0, 1000, 0);
        if (out.range != null)
            out.range = clampNumber(out.range, 0, 30, 1);
        // Filter and cap tag list — at most 10 known tags per jutsu.
        const rawTags = Array.isArray(out.tags) ? out.tags : [];
        let cleanTags = rawTags
            .filter((t) => !!t && typeof t === 'object')
            .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
            .slice(0, 10);
        // v4.3 Pierce: at most one Pierce per loadout; subsequent Pierces are stripped.
        // Pierce jutsu AP is forced to 60.
        const hasPierce = cleanTags.some(t => t.name === 'Pierce');
        if (hasPierce) {
            if (piercesSeen >= 1) {
                cleanTags = cleanTags.filter(t => t.name !== 'Pierce');
            }
            else {
                piercesSeen += 1;
                out.ap = 60;
            }
        }
        out.tags = cleanTags;
        return out;
    });
}
// Acceptable weapon elements — must match VALID_ELEMENTS below so the weather
// multiplier in api/pvp/move.ts treats this field consistently. Unknown
// elements are dropped (no weather interaction) rather than blocking the item.
const VALID_WEAPON_ELEMENTS = new Set([
    '', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang',
]);
// 'both' is the only effect-target token the move handler treats specially
// (Smoke Bomb path). 'enemy' is accepted as a legacy alias of 'opponent' —
// the client GameItem type still allows "enemy" so the sanitizer must too,
// otherwise valid items would have their target field silently dropped.
// Anything outside this set is dropped so a tampered save can't activate an
// as-yet-unwritten code path by guessing future tokens.
const VALID_WEAPON_EFFECT_TARGETS = new Set([
    'self', 'opponent', 'enemy', 'both',
]);
// Mirrors sanitizeJutsuList for equipped weapons / armor / consumables /
// throwables. A pvpItem is read by api/pvp/move.ts as an authoritative source
// of damage, range, AP cost, tags, and elemental affinity, so a tampered save
// could otherwise inject a 999999-EP free-cost ranged weapon or apply unknown
// tags. Clamps numerics, whitelists tag names + element, drops anything
// suspicious.
function sanitizePvpItems(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((i) => !!i && typeof i === 'object')
        .map((item) => {
        const out = { ...item };
        // Numeric clamps — match the jutsu sanitizer's bounds so weapons
        // can't out-scale jutsus.
        if (out.weaponEp != null)
            out.weaponEp = clampNumber(out.weaponEp, 0, 600, 0);
        if (out.weaponRange != null)
            out.weaponRange = clampNumber(out.weaponRange, 0, 30, 1);
        if (out.apCost != null)
            out.apCost = clampNumber(out.apCost, 0, 200, 40);
        if (out.weaponEffectValue != null)
            out.weaponEffectValue = clampNumber(out.weaponEffectValue, 0, 100, 0);
        // Tag list — same whitelist + cap (10) as sanitizeJutsuList.
        if (out.weaponTags != null) {
            const rawTags = Array.isArray(out.weaponTags) ? out.weaponTags : [];
            out.weaponTags = rawTags
                .filter((t) => !!t && typeof t === 'object')
                .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                .map((t) => {
                const tag = { name: String(t.name) };
                if (t.percent != null)
                    tag.percent = clampNumber(t.percent, 0, 100, 0);
                if (t.amount != null)
                    tag.amount = clampNumber(t.amount, 0, 10000, 0);
                return tag;
            })
                .slice(0, 10);
        }
        // weaponEffect / weaponElement / weaponEffectTarget — drop if not
        // in their respective whitelists rather than blocking the whole
        // item, so a single bad field doesn't disarm the player.
        if (out.weaponEffect != null && !KNOWN_TAG_NAMES.has(String(out.weaponEffect))) {
            delete out.weaponEffect;
        }
        if (out.weaponElement != null && !VALID_WEAPON_ELEMENTS.has(String(out.weaponElement))) {
            delete out.weaponElement;
        }
        if (out.weaponEffectTarget != null && !VALID_WEAPON_EFFECT_TARGETS.has(String(out.weaponEffectTarget))) {
            delete out.weaponEffectTarget;
        }
        // String identity fields — equippedPvpItem matches on item.id and
        // item.name, so non-string values would break the lookup.
        if (out.id != null && typeof out.id !== 'string')
            delete out.id;
        if (out.name != null && typeof out.name !== 'string')
            delete out.name;
        if (out.slot != null && typeof out.slot !== 'string')
            delete out.slot;
        return out;
    });
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
const SESSION_STRIP_CHAR_FIELDS = new Set([
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
// Exported so other PvP entry points that return an opponent character to the
// attacker (e.g. village-guard/challenge) can apply the SAME combat-safe
// projection instead of leaking the opponent's full private save (currencies,
// inventory, journals). Keeps stats/jutsu/equipment/bloodlines needed for the
// fight; strips everything economic / scouting-irrelevant.
function stripNonCombatFields(character) {
    const out = {};
    for (const [k, v] of Object.entries(character)) {
        if (SESSION_STRIP_CHAR_FIELDS.has(k))
            continue;
        out[k] = v;
    }
    return out;
}
// Hydrate a fighter character from the authoritative save. The client payload
// is only used as a fallback for fields the save lacks (e.g. computed
// bloodlineMult on NPCs without a save).
function hydrateCharacterFromSave(saveCharacter, clientCharacter) {
    // Start with the save (server is authority for HP, level, stats, etc.).
    const merged = { ...saveCharacter };
    // For derived fields the client computes, fall back to the client value
    // only when the save doesn't have a usable value. All within safe bounds.
    const pickClamped = (saveVal, clientVal, min, max, fb) => {
        if (saveVal != null && Number.isFinite(Number(saveVal)))
            return clampNumber(saveVal, min, max, fb);
        return clampNumber(clientVal, min, max, fb);
    };
    merged.bloodlineMult = pickClamped(saveCharacter.bloodlineMult, clientCharacter.bloodlineMult, 1.0, 3.0, 1.0);
    merged.armorFactor = pickClamped(saveCharacter.armorFactor, clientCharacter.armorFactor, 0.25, 1.0, 1.0);
    merged.armorRawDR = pickClamped(saveCharacter.armorRawDR, clientCharacter.armorRawDR, 0, 1.5, 0);
    merged.itemDamagePct = pickClamped(saveCharacter.itemDamagePct, clientCharacter.itemDamagePct, 0, 200, 0);
    // Named-armor passives. Percentage values cap at 100 (no point allowing
    // 100%+ absorb/reflect/lifesteal). Shield is flat HP — capped at 5000
    // to prevent a degenerate equipment stack from making a fighter unkillable.
    merged.itemAbsorbPct = pickClamped(saveCharacter.itemAbsorbPct, clientCharacter.itemAbsorbPct, 0, 100, 0);
    merged.itemReflectPct = pickClamped(saveCharacter.itemReflectPct, clientCharacter.itemReflectPct, 0, 100, 0);
    merged.itemLifeStealPct = pickClamped(saveCharacter.itemLifeStealPct, clientCharacter.itemLifeStealPct, 0, 100, 0);
    merged.itemShield = pickClamped(saveCharacter.itemShield, clientCharacter.itemShield, 0, 5000, 0);
    // Per-stat defense-in-depth clamp. Save endpoint already gates stat-gain
    // rates (api/save/[name].ts), but a tampered KV row or NPC payload could
    // still ship 999999 on a single stat. Each stat clamps to [0, MAX_STAT].
    //
    // The damage formula's getOffense/getDefense (api/pvp/move.ts) pairs each
    // school's offense vs the SAME school's defense, plus its two general
    // stats — so these all matter symmetrically:
    //   Taijutsu  → taiOff/taiDef + strength + speed
    //   Bukijutsu → bukiOff/bukiDef + intelligence + strength
    //   Genjutsu  → genOff/genDef + intelligence + willpower
    //   Ninjutsu  → ninOff/ninDef + willpower + speed
    merged.stats = clampStatsObject(saveCharacter.stats ?? clientCharacter.stats);
    // Sanitize loadout fields (jutsu list, pvpItems) — these ARE persisted.
    merged.jutsu = sanitizeJutsuList(saveCharacter.jutsu ?? clientCharacter.jutsu);
    merged.pvpItems = sanitizePvpItems(saveCharacter.pvpItems ?? clientCharacter.pvpItems);
    // Strip everything that isn't combat-relevant. The session is read by
    // spectators (and by the unauth /api/pvp/stream endpoint) so anything
    // sensitive (ryo, currencies, inventory, journals) would leak otherwise.
    return stripNonCombatFields(merged);
}
// MAX_STAT = 2500 (matches api/pvp/move.ts and shinobij.client/src/App.tsx).
// If this ever needs to change, update all three sites.
const SESSION_MAX_STAT = 2500;
const CLAMPED_STAT_FIELDS = [
    // Per-school offense/defense pairs — used by getOffense/getDefense in
    // api/pvp/move.ts. Each school's offense reads against the same school's
    // defense, so the cap has to be symmetric (no one stat can outrun its
    // mirror).
    'taijutsuOffense', 'taijutsuDefense',
    'bukijutsuOffense', 'bukijutsuDefense',
    'ninjutsuOffense', 'ninjutsuDefense',
    'genjutsuOffense', 'genjutsuDefense',
    // General stats — each one feeds two schools (strength → tai+buki,
    // speed → tai+nin, intelligence → buki+gen, willpower → gen+nin).
    'strength', 'speed', 'intelligence', 'willpower',
];
function clampStatsObject(raw) {
    const out = {};
    const src = (raw && typeof raw === 'object') ? raw : {};
    for (const key of CLAMPED_STAT_FIELDS) {
        out[key] = clampNumber(src[key], 0, SESSION_MAX_STAT, 0);
    }
    // Pass through any non-combat stat fields untouched (e.g., display-only
    // labels). Only the formula-facing stats above are clamped.
    for (const [k, v] of Object.entries(src)) {
        if (CLAMPED_STAT_FIELDS.includes(k))
            continue;
        if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
            out[k] = v;
    }
    return out;
}
// For NPC opponents (no save key in KV), we still clamp the client payload
// rather than trusting it as-is — caller already restricted this path to
// arena PvP-vs-AI flows that don't persist.
function hydrateNpcCharacter(clientCharacter) {
    const out = { ...clientCharacter };
    out.bloodlineMult = clampNumber(out.bloodlineMult, 1.0, 3.0, 1.0);
    out.armorFactor = clampNumber(out.armorFactor, 0.25, 1.0, 1.0);
    out.armorRawDR = clampNumber(out.armorRawDR, 0, 1.5, 0);
    out.itemDamagePct = clampNumber(out.itemDamagePct, 0, 200, 0);
    out.itemAbsorbPct = clampNumber(out.itemAbsorbPct, 0, 100, 0);
    out.itemReflectPct = clampNumber(out.itemReflectPct, 0, 100, 0);
    out.itemLifeStealPct = clampNumber(out.itemLifeStealPct, 0, 100, 0);
    out.itemShield = clampNumber(out.itemShield, 0, 5000, 0);
    out.stats = clampStatsObject(out.stats);
    out.jutsu = sanitizeJutsuList(out.jutsu);
    out.pvpItems = sanitizePvpItems(out.pvpItems);
    // Same strip as real characters — NPCs can have arbitrary client-
    // supplied fields and we don't want any of the sensitive ones to land
    // in the session record either.
    return stripNonCombatFields(out);
}
function makeFighter(char, pos, useCurrentVitals) {
    const maxHp = Number(char.maxHp ?? 100);
    const maxChakra = Number(char.maxChakra ?? 50);
    const maxStamina = Number(char.maxStamina ?? 50);
    // Named-armor "Shield" passive: starting flat shield, already clamped
    // to [0, 5000] during character merge.
    const startingShield = Math.max(0, Math.min(5000, Number(char.itemShield ?? 0)));
    // Spar / ranked PvP fights are fresh-start contests — full HP/chakra/
    // stamina. Sector attacks and the village defense/attack system are
    // continuous engagements where the fighter brings whatever vitals they
    // currently have (so a damaged player who keeps raiding stays damaged).
    // useCurrentVitals=true preserves char.hp/chakra/stamina; false resets.
    const startHp = useCurrentVitals ? Math.min(Number(char.hp ?? maxHp), maxHp) : maxHp;
    const startChakra = useCurrentVitals ? Math.min(Number(char.chakra ?? maxChakra), maxChakra) : maxChakra;
    const startStamina = useCurrentVitals ? Math.min(Number(char.stamina ?? maxStamina), maxStamina) : maxStamina;
    return {
        name: char.name ?? 'Unknown',
        hp: startHp,
        maxHp,
        chakra: startChakra,
        maxChakra,
        stamina: startStamina,
        maxStamina,
        shield: startingShield,
        statuses: [],
        character: char,
        pos,
    };
}
const VALID_BIOMES = new Set(['forest', 'snow', 'volcano', 'shadow', 'central']);
const VALID_ELEMENTS = new Set(['', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang']);
function normalizeBiome(b) {
    if (typeof b === 'string' && VALID_BIOMES.has(b))
        return b;
    return 'central';
}
function normalizeElement(e) {
    if (typeof e === 'string' && VALID_ELEMENTS.has(e))
        return e;
    return '';
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        // Poll endpoint — clients hit this every ~1s while the battle screen
        // is open. Generous budget per IP so two players + spectators can
        // share an IP, but block obvious abuse (≥10 polls/sec sustained).
        if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pvp-session-get', 360, 60_000)))
            return;
        const battleId = String(req.query.id ?? '');
        if (!battleId)
            return res.status(400).json({ error: 'Missing id' });
        const session = await _storage_js_1.kv.get(`pvp:${battleId}`);
        if (!session)
            return res.status(404).json({ error: 'Session not found' });
        // Never cache battle state — both fighters poll every ~1s and need fresh data
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(session);
    }
    if (req.method === 'POST') {
        // Require a logged-in player. The creator must be one of the two
        // fighters (or admin) — otherwise anyone could fabricate a PvP session
        // with arbitrary stats (e.g. 999999 HP god mode).
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        // Cap session creation. A legit player starts a duel maybe every
        // 30s in heavy play; 6/min is comfortable headroom and stops
        // KV-fill attacks that spam-create sessions. Admins skip the cap
        // (testing scripts may legitimately create many sessions fast).
        const rlName = identity.admin ? undefined : identity.name;
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pvp-session-create', 6, 60_000, rlName)))
            return;
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { p1Character, p2Character, biome, weatherPositiveElement, weatherNegativeElement, battleId: clientBattleId, useCurrentVitals, ranked, rankedKind, baseRewards, rewardSector } = body;
            if (!p1Character || !p2Character)
                return res.status(400).json({ error: 'Missing characters' });
            const p1Name = p1Character.name ?? 'Player 1';
            const p2Name = p2Character.name ?? 'Player 2';
            const p1Norm = (0, _utils_js_1.safeName)(String(p1Name));
            const p2Norm = (0, _utils_js_1.safeName)(String(p2Name));
            if (!identity.admin) {
                const me = identity.name;
                if (me !== p1Norm && me !== p2Norm) {
                    return res.status(403).json({ error: 'Can only create sessions you are a fighter in.' });
                }
                // Reject self-duels. With p1 and p2 resolving to the SAME
                // account, a player controls both sides — letting them farm a
                // guaranteed win on the ranked / vanguard / base-reward paths
                // (and the reward settlement would read+write one save as both
                // winner and loser). Admins keep the override (test fights).
                if (p1Norm && p2Norm && p1Norm === p2Norm) {
                    return res.status(400).json({ error: 'You cannot duel yourself.' });
                }
                // #4: enforce the anti-grief presence gate HERE, at session
                // creation — the real gate. The client creates the session
                // BEFORE /api/player/challenge (which skips its own gate once a
                // battleId exists) or /api/player/attack, so without this a
                // player could fight a traveling / already-in-battle / engaged
                // target by pre-creating the session. Only the opponent (the
                // fighter who is NOT the creator) is gated, only when they're a
                // real ONLINE player; offline targets stay optimistic/queued.
                const opponentNorm = me === p1Norm ? p2Norm : p1Norm;
                if (opponentNorm) {
                    const block = (0, presence_gating_js_1.sessionOpponentBlock)(online_store_js_1.onlineStore.get(opponentNorm), me);
                    if (block)
                        return res.status(block.status).json({ error: block.error });
                }
            }
            // ── Hydrate both fighters from authoritative saves ───────────────
            // The creator only really supplies the names (and an NPC payload
            // for AI fights). We load each fighter's persisted save and pull
            // jutsu / pvpItems / armor / bloodlineMult / itemDamagePct from
            // there. The client's character body is only consulted as a
            // fallback for fighters who don't have a save record (NPCs).
            // Admins keep their override path (admin acts as anyone for tests).
            let finalP1Character;
            let finalP2Character;
            const [p1Save, p2Save] = await Promise.all([
                p1Norm ? _storage_js_1.kv.get(`save:${p1Norm}`) : Promise.resolve(null),
                p2Norm ? _storage_js_1.kv.get(`save:${p2Norm}`) : Promise.resolve(null),
            ]);
            if (p1Save?.character) {
                finalP1Character = hydrateCharacterFromSave(p1Save.character, p1Character);
            }
            else if (identity.admin) {
                finalP1Character = hydrateNpcCharacter(p1Character);
            }
            else if (identity.name === p1Norm) {
                return res.status(400).json({ error: 'Your character save was not found on the server.' });
            }
            else {
                // Opponent has no save → NPC. Clamp client payload defensively.
                finalP1Character = hydrateNpcCharacter(p1Character);
            }
            if (p2Save?.character) {
                finalP2Character = hydrateCharacterFromSave(p2Save.character, p2Character);
            }
            else if (identity.admin) {
                finalP2Character = hydrateNpcCharacter(p2Character);
            }
            else if (identity.name === p2Norm) {
                return res.status(400).json({ error: 'Your character save was not found on the server.' });
            }
            else {
                finalP2Character = hydrateNpcCharacter(p2Character);
            }
            // Sector / guard fights bring current vitals — refuse to start
            // one with a 0-HP fighter so a dead attacker can't be created
            // via direct API calls (the client UI should already gate this,
            // this is the server-side belt). Spar / ranked / arena reset to
            // max anyway so they're unaffected.
            if (useCurrentVitals === true) {
                const p1Hp = Number(finalP1Character.hp ?? 0);
                const p2Hp = Number(finalP2Character.hp ?? 0);
                if (p1Hp <= 0) {
                    return res.status(400).json({ error: `${p1Name} is unconscious and cannot enter this fight.` });
                }
                if (p2Hp <= 0) {
                    return res.status(400).json({ error: `${p2Name} is unconscious and cannot enter this fight.` });
                }
            }
            // Server-generated battleId. We used to accept a client-supplied
            // id (for optimistic navigation) — but that let an attacker
            // pre-claim guessable ids to later scrape via /api/pvp/stream
            // (which is unauth by design for EventSource compat). Server-only
            // ids close that scrape vector. The client just waits the ~50ms
            // round trip for the id before navigating; UX impact is invisible.
            void clientBattleId; // intentionally ignored
            // Crypto-random id: knowing a battleId grants read access to the
            // session + SSE stream + chat (GET is unauth by design for
            // EventSource), so it doubles as a capability token. The old
            // `Date.now()-Math.random().slice(2,9)` suffix was only ~36^7 and
            // time-seeded — brute-forceable within a timestamp window. A UUIDv4
            // (122 bits of entropy) closes the scrape vector. Same `pvp-`
            // prefix so all existing key/route patterns are unchanged.
            const battleId = `pvp-${(0, crypto_1.randomUUID)()}`;
            // True 50/50 coin flip — going first is a meaningful turn-based
            // advantage and previously the attacker (always p1) won by default.
            // Now both sides have an equal shot at the opening move; the
            // prefight overlay's "X goes first!" reveal matches the server roll.
            // Use crypto.randomBytes for the coin flip — Math.random() is
            // V8-seeded and at session-creation rates could in principle be
            // biased/predicted via timing correlation.
            const firstActor = ((0, crypto_1.randomBytes)(1)[0] & 1) === 0 ? 'p1' : 'p2';
            const firstActorName = firstActor === 'p1' ? p1Name : p2Name;
            // ── Ranked snapshot (audit #7 / Stage 3) ─────────────────────────
            // When the client flags this match ranked, record each fighter's
            // pre-match Elo read from their SAVE (authoritative), keyed to the
            // ladder. claim-rewards reads these back + the server winner to
            // compute and durably credit the rating change — the client can no
            // longer compute or self-apply the delta. NPC fighters (no save)
            // default to 1000, matching the client's `?? 1000`. The `ranked`
            // assertion itself is currently client-supplied (a documented
            // follow-up will tie it to the queue/challenge record); the RATINGS,
            // WINNER and MAGNITUDE are all server-authoritative regardless.
            let rankedStamp = {};
            if (ranked === true && (rankedKind === 'player' || rankedKind === 'pet')) {
                const ratingField = rankedKind === 'pet' ? 'petRankedRating' : 'rankedRating';
                const ratingOf = (save) => {
                    const c = (save?.character ?? null);
                    const r = Number(c?.[ratingField]);
                    return Number.isFinite(r) ? r : 1000;
                };
                rankedStamp = {
                    ranked: true,
                    rankedKind,
                    p1Rating: ratingOf(p1Save),
                    p2Rating: ratingOf(p2Save),
                };
            }
            // ── Base-reward stamp (audit #7 / Stage 3 Phase 3) ───────────────
            // Opt this session into server crediting of the winner's base ryo +
            // XP. Only the sector matters for the math (Death's Gate ×2); the
            // pet trait + elder focus + exam gates are read from the winner's
            // full save under the claim lock. Dormant until the client opts in.
            let baseRewardStamp = {};
            if (baseRewards === true) {
                const s = Number(rewardSector);
                baseRewardStamp = { baseRewards: true, rewardSector: Number.isFinite(s) ? Math.floor(s) : 0 };
            }
            const session = {
                battleId,
                p1: makeFighter(finalP1Character, P1_START, useCurrentVitals === true),
                p2: makeFighter(finalP2Character, P2_START, useCurrentVitals === true),
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
                ...rankedStamp,
                ...baseRewardStamp,
            };
            await _storage_js_1.kv.set(`pvp:${battleId}`, session, { ex: SESSION_TTL });
            // Return the full session alongside the id so the client can seed
            // PvpBattleScreen's state on mount and skip the redundant GET
            // round trip that immediately follows a POST. Same data the GET
            // endpoint returns (and GET is unauthenticated for spectator-by-id
            // / EventSource compat), so no new exposure here — POST itself is
            // already gated to a fighter or admin via authedPlayerOrAdmin.
            return res.status(200).json({ battleId, session });
        }
        catch (err) {
            console.error('[pvp/session]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}

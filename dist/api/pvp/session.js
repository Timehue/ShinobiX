"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PVP_LOG_MAX_LINES = exports.PVP_MOVE_TOKEN_HISTORY = void 0;
exports.trimPvpLog = trimPvpLog;
exports.sanitizeJutsuList = sanitizeJutsuList;
exports.sanitizePvpItems = sanitizePvpItems;
exports.stripNonCombatFields = stripNonCombatFields;
exports.hydrateCharacterFromSave = hydrateCharacterFromSave;
exports.ownedItemCount = ownedItemCount;
exports.sealItemCharges = sealItemCharges;
exports.default = handler;
const crypto_1 = require("crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const online_store_js_1 = require("../_realtime/online-store.js");
const presence_gating_js_1 = require("../_realtime/presence-gating.js");
const _ranked_match_token_js_1 = require("../_ranked-match-token.js");
const _jutsu_catalog_js_1 = require("./_jutsu-catalog.js");
const _multipliers_js_1 = require("./_multipliers.js");
const _tags_js_1 = require("./_tags.js");
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
// Acceptable jutsu-tag names (canonical + aliases) come from the shared tag
// contract (api/pvp/_tags.ts), which the combat resolver in api/pvp/move.ts
// also imports — so the whitelist and the handler can't drift. Tags surviving
// the whitelist are canonicalized here, so the session is sealed with canonical
// names and combat never has to re-normalize aliases.
// A jutsu can only deal damage (and thus resolve post-damage tags like Wound /
// Siphon) when it pierces, or when it has positive effect power and isn't a
// zero-damage utility cast. Mirrors isZeroDamageFortyApJutsu in move.ts.
function jutsuCanDealDamage(out, canonicalTagNames) {
    if (canonicalTagNames.includes('Pierce'))
        return true;
    const ep = Number(out.effectPower) || 0;
    if (ep <= 0)
        return false;
    if (out.isUtility === true)
        return false;
    if (out.isUtility === false)
        return true;
    const id = String(out.id ?? '');
    if (out.ap === 40 && id !== 'basic-attack' && !id.startsWith('item-'))
        return false;
    return true;
}
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
        // Filter, canonicalize, and cap the tag list — at most 10 known tags
        // per jutsu. Names are canonicalized HERE so the session is sealed
        // with canonical tags and the combat resolver never re-normalizes.
        const rawTags = Array.isArray(out.tags) ? out.tags : [];
        let cleanTags = rawTags
            .filter((t) => !!t && typeof t === 'object')
            .filter((t) => typeof t.name === 'string' && _tags_js_1.KNOWN_TAG_NAMES.has(String(t.name)))
            .map((t) => ({ ...t, name: (0, _tags_js_1.canonicalTagName)(String(t.name)) }))
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
        // Semantic cleanup: post-damage-only tags (Wound, Siphon) can never
        // resolve on a cast that deals no damage, so strip them instead of
        // leaving a silent no-op on the loadout. A jutsu that can deal damage
        // (pierce, or positive-EP non-utility) keeps them.
        if (!jutsuCanDealDamage(out, cleanTags.map(t => String(t.name)))) {
            cleanTags = cleanTags.filter(t => !_tags_js_1.REQUIRES_DAMAGE_TAGS.has(String(t.name)));
        }
        out.tags = cleanTags;
        // Normalize away the legacy EP-100 "fixed effect" sentinel: a jutsu
        // carrying a binary control / displacement tag deals STANDARD 60-AP
        // damage, not effectPower-100 (~3200). Clamp before the value can ever
        // reach the combat formula (also fixes the AOE Move-strip path, since
        // the EP is already honest before Move is stripped). 40-AP fixed-effect
        // jutsu stay zero-damage via the utility rule regardless.
        if ((0, _tags_js_1.jutsuHasFixedEffectPower)(cleanTags) && Number(out.effectPower) > _tags_js_1.FIXED_EFFECT_STANDARD_EP) {
            out.effectPower = _tags_js_1.FIXED_EFFECT_STANDARD_EP;
        }
        // Bloodline weather affinity — keep only a valid weather token (a base
        // element, or "None" for no interaction). An invalid value is dropped
        // so weatherMultiplier falls back to the jutsu's own `element`; "None"
        // is kept so it never matches a weather element (no buff/debuff).
        if (out.weatherElement != null && !VALID_WEATHER_ELEMENTS.has(String(out.weatherElement))) {
            delete out.weatherElement;
        }
        return out;
    });
}
// Acceptable bloodline weather elements: the five base elements plus the
// explicit "None" (flavor-only, no weather interaction). Mirrors the client's
// weather-element choices in the Bloodline Maker.
const VALID_WEATHER_ELEMENTS = new Set([
    'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'None',
]);
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
        // Cooldown (rounds) — enforced server-side in move.ts for thrown
        // weapons + combat items. Clamp so a tampered save can't seal a
        // negative/absurd value; 0 = no cooldown (the melee/legacy default).
        if (out.weaponCooldown != null)
            out.weaponCooldown = clampNumber(out.weaponCooldown, 0, 30, 0);
        if (out.apCost != null)
            out.apCost = clampNumber(out.apCost, 0, 200, 40);
        // Flat potion restore (chakra/stamina) — clamp to the same 5000 cap
        // the vitals merge uses so a tampered pvpItem can't over-restore.
        if (out.restoreChakra != null)
            out.restoreChakra = clampNumber(out.restoreChakra, 0, 5000, 0);
        if (out.restoreStamina != null)
            out.restoreStamina = clampNumber(out.restoreStamina, 0, 5000, 0);
        if (out.weaponEffectValue != null)
            out.weaponEffectValue = clampNumber(out.weaponEffectValue, 0, 100, 0);
        // Tag list — same whitelist + cap (10) as sanitizeJutsuList.
        if (out.weaponTags != null) {
            const rawTags = Array.isArray(out.weaponTags) ? out.weaponTags : [];
            out.weaponTags = rawTags
                .filter((t) => !!t && typeof t === 'object')
                .filter((t) => typeof t.name === 'string' && _tags_js_1.KNOWN_TAG_NAMES.has(String(t.name)))
                .map((t) => {
                // Canonicalize so the weapon-built jutsu carries canonical
                // tags into applyJutsu, same as sanitizeJutsuList.
                const tag = { name: (0, _tags_js_1.canonicalTagName)(String(t.name)) };
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
        // item, so a single bad field doesn't disarm the player. The effect
        // is canonicalized (it becomes a jutsu tag in move.ts).
        if (out.weaponEffect != null) {
            if (_tags_js_1.KNOWN_TAG_NAMES.has(String(out.weaponEffect))) {
                out.weaponEffect = (0, _tags_js_1.canonicalTagName)(String(out.weaponEffect));
            }
            else {
                delete out.weaponEffect;
            }
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
// Validate the jutsu-mastery list shape before it's sealed. move.ts reads
// `character.jutsuMastery` for EP / Drain scaling; a non-array value (tampered
// KV row or NPC payload) would crash the move handler's `.find(...)` → 500 on
// every move. Levels are clamped to [0,50] here (and again at use in move.ts);
// entries without a string jutsuId are dropped. Only {jutsuId, level} survive —
// the session is a combat snapshot and never writes mastery back to the save.
function sanitizeMastery(raw) {
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((m) => !!m && typeof m === 'object')
        .filter((m) => typeof m.jutsuId === 'string')
        .map((m) => ({ jutsuId: String(m.jutsuId), level: clampNumber(m.level, 0, 50, 0) }))
        .slice(0, 1000);
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
    'inventory', 'itemStacks', 'tileCards', 'savedTileDeck',
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
    'battleTowerBestFloor', 'battleTowerRating', 'battleTowerClearedFloors',
    'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed',
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
// ─── Server-authoritative loadout resolution ────────────────────────────────
// Resolve a player's equipped loadout into real jutsu objects from the SERVER's
// own catalog (built-in starters + the four built-in bloodlines) plus the jutsu
// objects the save itself carries (the player's own bloodlines + creator jutsu).
//
// This is the fix for the "defender's jutsu don't load" bug. Previously the
// server had no way to turn an `equippedJutsuIds` list into jutsu objects, so it
// trusted whatever loadout the SESSION CREATOR's client sent — which, when you
// attack someone, is only their PUBLIC projection (jutsu stripped) → an empty
// loadout, leaving the defender unable to cast anything. Now the loadout is
// rebuilt from the defender's OWN save and never depends on who created the
// session.
//
// Built-in jutsu ALWAYS use the catalog values, so a tampered save can't inflate
// a starter's effectPower/tags past the real numbers. Player-owned bloodline +
// creator jutsu come from the save; the client body is only a last-resort
// supplement for a jutsu the save somehow lacks (no worse than the old
// fully-client path, and still run through sanitizeJutsuList below).
function jutsuObjectsById(target, arr) {
    if (!Array.isArray(arr))
        return;
    for (const j of arr) {
        if (j && typeof j === 'object' && typeof j.id === 'string') {
            target.set(String(j.id), j);
        }
    }
}
function resolveEquippedLoadout(saveCharacter, save, clientCharacter) {
    const rawIds = saveCharacter.equippedJutsuIds;
    if (!Array.isArray(rawIds) || rawIds.length === 0)
        return null;
    const equippedIds = rawIds.filter((id) => typeof id === 'string');
    if (equippedIds.length === 0)
        return null;
    // Non-catalog sources, lowest priority first so later sources overwrite:
    //   client body (weakest) → save's bloodlines + creator jutsu (authoritative).
    const extra = new Map();
    jutsuObjectsById(extra, clientCharacter.jutsu);
    if (save) {
        const bloodlines = save.savedBloodlines;
        if (Array.isArray(bloodlines)) {
            for (const b of bloodlines) {
                if (b && typeof b === 'object')
                    jutsuObjectsById(extra, b.jutsus);
            }
        }
        jutsuObjectsById(extra, save.creatorJutsus);
    }
    const resolved = [];
    for (const id of equippedIds) {
        const fromCatalog = _jutsu_catalog_js_1.JUTSU_CATALOG[id];
        if (fromCatalog) {
            resolved.push({ ...fromCatalog });
            continue;
        }
        const fromExtra = extra.get(id);
        if (fromExtra)
            resolved.push(fromExtra);
        // else: unknown id (not built-in, not in the save's content) → dropped.
    }
    return resolved;
}
// Resolve a fighter's equipped items (weapons / throwables / consumables / armor)
// server-side from the authoritative save — mirroring resolveEquippedLoadout for
// jutsu. The client builds pvpItems via getPvpItemLoadout (equipment ids ∩ the
// item catalog), but pvpItems is NOT persisted, so the old
// `saveCharacter.pvpItems ?? clientCharacter.pvpItems` trusted the SESSION
// CREATOR's client — a defender whose creatorItems failed to sync would fight
// WITHOUT their named weapon. Resolving from the save's own equipment +
// creatorItems (∪ the built-in ITEM_CATALOG via buildItemLookup) fixes that and
// makes weapon stats authoritative. Returns null for save-less callers (NPCs)
// so the existing client fallback still applies.
function resolveEquippedPvpItems(saveCharacter, save) {
    if (!save)
        return null;
    const equipment = saveCharacter.equipment;
    if (!equipment || typeof equipment !== 'object')
        return null;
    const ids = [...new Set(Object.values(equipment).filter((v) => typeof v === 'string'))];
    if (ids.length === 0)
        return null;
    const getItem = (0, _multipliers_js_1.buildItemLookup)(save.creatorItems);
    const resolved = [];
    for (const id of ids) {
        const item = getItem(id);
        if (item)
            resolved.push({ ...item });
        // else: unknown id (not built-in, not in the player's creatorItems) → dropped.
    }
    return resolved;
}
// Hydrate a fighter character from the authoritative save. The client payload
// is only used as a fallback for fields the save lacks (e.g. computed
// bloodlineMult on NPCs without a save).
//
// Exported so OTHER server-authoritative combat modes (e.g. Battle Towers' fighter
// sealing in api/towers/_seal.ts) can produce a fighter character IDENTICAL to PvP's
// — same resolved equipped loadout, mastery, armor passives, stat/vital clamps, and
// non-combat strip — instead of hand-rolling a divergent snapshot. Pure read function;
// exporting it changes zero PvP behaviour.
function hydrateCharacterFromSave(saveCharacter, clientCharacter, save = null) {
    // Start with the save (server is authority for HP, level, stats, etc.).
    const merged = { ...saveCharacter };
    // For derived fields the client computes, fall back to the client value
    // only when the save doesn't have a usable value. All within safe bounds.
    const pickClamped = (saveVal, clientVal, min, max, fb) => {
        if (saveVal != null && Number.isFinite(Number(saveVal)))
            return clampNumber(saveVal, min, max, fb);
        return clampNumber(clientVal, min, max, fb);
    };
    // Combat multipliers (offense/defense layer). When we have the authoritative
    // save, DERIVE them server-side from the equipped bloodline rank + equipped
    // armor/items (see api/pvp/_multipliers.ts) so a tampered client can't
    // under/over-report them for EITHER fighter — this was the one place damage
    // inputs were still client-trusted. Honest fighters get identical numbers;
    // the clamps below stay as a final ceiling. Without a save (legacy/edge
    // callers — the real PvP + Battle Towers paths always pass one; NPCs use
    // hydrateNpcCharacter) fall back to the clamped client value as before.
    const numOr = (saveVal, clientVal) => saveVal != null && Number.isFinite(Number(saveVal)) ? Number(saveVal) : Number(clientVal);
    const mult = save
        ? (0, _multipliers_js_1.deriveCombatMultipliers)(saveCharacter, save)
        : {
            bloodlineMult: numOr(saveCharacter.bloodlineMult, clientCharacter.bloodlineMult),
            armorFactor: numOr(saveCharacter.armorFactor, clientCharacter.armorFactor),
            armorRawDR: numOr(saveCharacter.armorRawDR, clientCharacter.armorRawDR),
            itemDamagePct: numOr(saveCharacter.itemDamagePct, clientCharacter.itemDamagePct),
            itemAbsorbPct: numOr(saveCharacter.itemAbsorbPct, clientCharacter.itemAbsorbPct),
            itemReflectPct: numOr(saveCharacter.itemReflectPct, clientCharacter.itemReflectPct),
            itemLifeStealPct: numOr(saveCharacter.itemLifeStealPct, clientCharacter.itemLifeStealPct),
            itemShield: numOr(saveCharacter.itemShield, clientCharacter.itemShield),
        };
    merged.bloodlineMult = clampNumber(mult.bloodlineMult, 1.0, 3.0, 1.0);
    merged.armorFactor = clampNumber(mult.armorFactor, 0.25, 1.0, 1.0);
    merged.armorRawDR = clampNumber(mult.armorRawDR, 0, 1.5, 0);
    merged.itemDamagePct = clampNumber(mult.itemDamagePct, 0, 200, 0);
    // Named-armor passives. Percentage values cap at 100 (no point allowing
    // 100%+ absorb/reflect/lifesteal). Shield is flat HP — capped at 5000
    // to prevent a degenerate equipment stack from making a fighter unkillable.
    merged.itemAbsorbPct = clampNumber(mult.itemAbsorbPct, 0, 100, 0);
    merged.itemReflectPct = clampNumber(mult.itemReflectPct, 0, 100, 0);
    merged.itemLifeStealPct = clampNumber(mult.itemLifeStealPct, 0, 100, 0);
    merged.itemShield = clampNumber(mult.itemShield, 0, 5000, 0);
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
    // Vitals defense-in-depth. A tampered save could ship a huge maxHp
    // (effectively unkillable) or maxChakra (Poison ticks scale off the victim's
    // maxChakra). Clamp to the game's hard caps — HP_CAP 10000, CHAKRA/STAMINA
    // 5000 — which no legitimate build exceeds (maxHpForLevel caps at HP_CAP).
    // NPC opponents use hydrateNpcCharacter (vitals left intact) so boss-tier HP
    // is preserved for PvP-vs-AI flows.
    merged.maxHp = pickClamped(saveCharacter.maxHp, clientCharacter.maxHp, 1, 10000, 100);
    merged.maxChakra = pickClamped(saveCharacter.maxChakra, clientCharacter.maxChakra, 0, 5000, 50);
    merged.maxStamina = pickClamped(saveCharacter.maxStamina, clientCharacter.maxStamina, 0, 5000, 50);
    // Shape-validate the mastery list (see sanitizeMastery) — guards the move
    // handler against a non-array crash and clamps each level to [0,50].
    merged.jutsuMastery = sanitizeMastery(saveCharacter.jutsuMastery ?? clientCharacter.jutsuMastery);
    // Sanitize loadout fields (jutsu list, pvpItems) — these ARE persisted.
    // Resolve the equipped loadout server-side from the catalog + the save's own
    // content (see resolveEquippedLoadout). Falls back to the raw save/client
    // jutsu only for old saves with no equippedJutsuIds and for NPCs.
    const resolvedLoadout = resolveEquippedLoadout(saveCharacter, save, clientCharacter);
    merged.jutsu = sanitizeJutsuList(resolvedLoadout ?? saveCharacter.jutsu ?? clientCharacter.jutsu);
    // Resolve equipped items from the authoritative save (see resolveEquippedPvpItems);
    // fall back to the persisted/client pvpItems for save-less (NPC) callers.
    const resolvedItems = resolveEquippedPvpItems(saveCharacter, save);
    merged.pvpItems = sanitizePvpItems(resolvedItems ?? saveCharacter.pvpItems ?? clientCharacter.pvpItems);
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
    // Shape-validate mastery (NPC payloads are client-supplied) so a malformed
    // value can't crash the move handler. NPC vitals are left intact on purpose
    // (boss-tier HP is legitimate for PvP-vs-AI).
    out.jutsuMastery = sanitizeMastery(out.jutsuMastery);
    out.jutsu = sanitizeJutsuList(out.jutsu);
    out.pvpItems = sanitizePvpItems(out.pvpItems);
    // Same strip as real characters — NPCs can have arbitrary client-
    // supplied fields and we don't want any of the sensitive ones to land
    // in the session record either.
    return stripNonCombatFields(out);
}
// How many of an item id a save character owns across both stores (counted
// itemStacks + legacy inventory[] copies). Mirrors the client lib/inventory
// countItem so the sealed PvP consumable budget matches what the player holds.
function ownedItemCount(char, id) {
    if (!char)
        return 0;
    let n = 0;
    const stacks = char.itemStacks;
    if (Array.isArray(stacks)) {
        for (const s of stacks) {
            if (s && s.itemId === id)
                n += Math.max(0, Math.floor(Number(s.count) || 0));
        }
    }
    const inv = char.inventory;
    if (Array.isArray(inv))
        n += inv.filter((x) => x === id).length;
    return n;
}
// Per-fight consumable cap for the Rejuvenation Potion (and any "potion" slot).
const POTION_USES_PER_BATTLE = 2;
// Seal the per-fight consumable budget from a fighter's equipped throwables,
// combat items, and potion. `equipChar` supplies the equipment slot→id map
// (equipment survives stripNonCombatFields); `invChar` is the RAW save (its
// inventory/itemStacks are stripped off the fighter snapshot, so owned counts
// must come from the save). For NPCs (no save) only the potion is sealed — at
// the cap — so the AI can't infinitely chug it; its other consumables stay
// unsealed (unlimited), preserving prior AI behaviour.
function sealItemCharges(equipChar, invChar) {
    const charges = {};
    const equip = (equipChar.equipment ?? {});
    // The three combat-item slots (item1/2/3) each hold one of Attack/Defense
    // Pill or Smoke Bomb; legacy 'item' covers a not-yet-migrated single-item
    // save. Throwable + combat items seal at the owned count; the potion is
    // capped per battle (handled below).
    for (const slot of ['thrown', 'item1', 'item2', 'item3', 'item', 'potion']) {
        const id = equip[slot];
        if (typeof id !== 'string' || !id)
            continue;
        if (slot === 'potion') {
            const owned = invChar ? ownedItemCount(invChar, id) : POTION_USES_PER_BATTLE;
            charges[id] = Math.min(owned, POTION_USES_PER_BATTLE);
        }
        else if (invChar) {
            charges[id] = ownedItemCount(invChar, id);
        }
    }
    return charges;
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
// ── Town Defense guard mitigation (server-authoritative) ─────────────────────
// A Village Guard's "Town Defense" upgrade is meant to reduce the damage they
// take "while defending through the Village Guard queue". The AI-fallback path
// already folds it into the chosen AI's effective level client-side, but a
// REAL-player guard duel previously dropped it entirely. We recompute it here
// from the guard's OWN save (never the client body or the client-stamped queue
// entry) and seal it onto the defender so api/pvp/move.ts can apply it as a
// small, capped damage reduction. Mirrors getTownDefenseGuardBonus in the
// client's lib/village-upgrades.ts: townDefense level × 0.1% per level, capped
// at the upgrade max (50 levels → 5%).
const TOWN_DEFENSE_PER_LEVEL = 0.1;
const TOWN_DEFENSE_MAX_LEVEL = 50;
const GUARD_DEFENSE_MAX_PCT = TOWN_DEFENSE_PER_LEVEL * TOWN_DEFENSE_MAX_LEVEL; // 5
function townDefensePctFromSave(saveCharacter) {
    const upgrades = (saveCharacter?.villageUpgrades ?? null);
    const level = Math.floor(clampNumber(upgrades?.townDefense, 0, TOWN_DEFENSE_MAX_LEVEL, 0));
    return Math.max(0, Math.min(GUARD_DEFENSE_MAX_PCT, level * TOWN_DEFENSE_PER_LEVEL));
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
                finalP1Character = hydrateCharacterFromSave(p1Save.character, p1Character, p1Save);
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
                finalP2Character = hydrateCharacterFromSave(p2Save.character, p2Character, p2Save);
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
            // #4 (newcomer protection / "below level 10 can't be attacked"):
            // a sub-ATTACKABLE_MIN_LEVEL shinobi can't be pulled into a sector
            // raid (useCurrentVitals) or a ranked battle as EITHER fighter.
            // Read from the AUTHORITATIVE save level (not the online store, which
            // can momentarily race to level 0), so a directly-POSTed / pre-created
            // session can't bypass the attack.ts / ranked-queue gates. Consensual
            // spars (useCurrentVitals=false & not ranked) stay open to everyone;
            // admins keep their test override.
            if (!identity.admin && (useCurrentVitals === true || ranked === true)) {
                const p1Level = Number(finalP1Character.level ?? 0);
                const p2Level = Number(finalP2Character.level ?? 0);
                if ((0, presence_gating_js_1.isBelowAttackableFloor)(p1Level) || (0, presence_gating_js_1.isBelowAttackableFloor)(p2Level)) {
                    return res.status(403).json({
                        error: `Shinobi below level ${presence_gating_js_1.ATTACKABLE_MIN_LEVEL} are under newcomer protection — they can't take part in sector raids or ranked battles yet.`,
                    });
                }
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
            // ── Seal the defending guard's Town Defense bonus ────────────────
            // Only for continuous (sector / guard) fights, only for the DEFENDER
            // (the fighter who is NOT the session creator / attacker), and only
            // while that defender is actually in the Village Guard rotation — so
            // an attacker can neither grant the bonus to themselves nor deny it
            // to the guard. The value is recomputed from the guard's OWN save;
            // the move resolver applies it as a ≤5% damage reduction.
            if (!identity.admin && useCurrentVitals === true) {
                const defenderRole = identity.name === p1Norm ? 'p2' : identity.name === p2Norm ? 'p1' : null;
                if (defenderRole) {
                    const defenderNorm = defenderRole === 'p1' ? p1Norm : p2Norm;
                    const defenderSave = defenderRole === 'p1' ? p1Save : p2Save;
                    const onGuardDuty = defenderNorm ? await _storage_js_1.kv.get(`guard:${defenderNorm}`) : null;
                    if (onGuardDuty) {
                        const pct = townDefensePctFromSave(defenderSave?.character);
                        if (pct > 0) {
                            if (defenderRole === 'p1')
                                finalP1Character.guardDefensePct = pct;
                            else
                                finalP2Character.guardDefensePct = pct;
                        }
                    }
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
            // ── Ranked snapshot (audit #7 / Stage 3; gated by audit #10) ──────
            // When the match is honored as ranked, record each fighter's
            // pre-match Elo read from their SAVE (authoritative), keyed to the
            // ladder. claim-rewards reads these back + the server winner to
            // compute and durably credit the rating change — the client can no
            // longer compute or self-apply the delta. NPC fighters (no save)
            // default to 1000, matching the client's `?? 1000`.
            //
            // #10: `ranked` from the body is only a client CLAIM. Require a
            // server-minted match token (from the ranked queue, sealed to THESE
            // two fighters on THIS ladder) and consume it single-use before
            // honoring it. No token → record the session as CASUAL (no stamp); the
            // battle still runs, and the RATINGS, WINNER and MAGNITUDE stay
            // server-authoritative regardless. Admins keep their override (test
            // fights never queue, so they'd have no token).
            let rankedStamp = {};
            if (ranked === true && (rankedKind === 'player' || rankedKind === 'pet')) {
                const proven = identity.admin
                    || await (0, _ranked_match_token_js_1.consumeRankedMatchToken)(p1Norm, p2Norm, rankedKind);
                if (proven) {
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
            // Ranked fights are fought on NEUTRAL ground. A session creator could
            // otherwise seal a biome/weather that boosts their own school/element
            // (+10% terrain dmg per matching cast, plus a weather edge) for the whole
            // ranked match — a persistent ladder advantage that bypasses the
            // element-of-the-day fairness goal. Mirror the client's ranked-neutral
            // rule (shinobij.client/src/lib/pvp-session.ts) on the server so a
            // tampered client holding a valid match token can't pick favorable
            // terrain. Casual fights keep the client-chosen environment.
            const isRankedSession = rankedStamp.ranked === true;
            const sealedBiome = isRankedSession ? 'central' : normalizeBiome(biome);
            const sealedWeatherPos = isRankedSession ? '' : normalizeElement(weatherPositiveElement);
            const sealedWeatherNeg = isRankedSession ? '' : normalizeElement(weatherNegativeElement);
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
                biome: sealedBiome,
                weatherPositiveElement: sealedWeatherPos,
                weatherNegativeElement: sealedWeatherNeg,
                // Seal each fighter's per-fight consumable budget from their save
                // (potion capped). move.ts decrements on use; claim-rewards
                // deducts itemsUsed from the save at settlement.
                itemCharges: {
                    p1: sealItemCharges(finalP1Character, p1Save?.character ?? null),
                    p2: sealItemCharges(finalP2Character, p2Save?.character ?? null),
                },
                itemsUsed: { p1: {}, p2: {} },
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

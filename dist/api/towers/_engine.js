"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MASTERY_MIN_DAMAGE_FRAC = exports.JUTSU_MAX_LEVEL = exports.K_DR = exports.BASIC_ATTACK_AP = exports.MOVE_AP = exports.STUN_AP_PENALTY = exports.MAX_ROUNDS = exports.MAX_ACTIONS = exports.BASE_AP = void 0;
exports.towerNeighbors = towerNeighbors;
exports.computeDamage = computeDamage;
exports.startRound = startRound;
exports.checkTowerWinner = checkTowerWinner;
exports.applyAction = applyAction;
exports.endTurn = endTurn;
exports.pickAiAction = pickAiAction;
exports.applyPartyScaling = applyPartyScaling;
exports.runTowerFloor = runTowerFloor;
exports.runAiUntilHuman = runAiUntilHuman;
/*
 * Battle Towers — N-actor combat ENGINE (Phase 1, P1.A2).
 *
 * The generalization of api/pvp/move.ts from 2 fighters (p1/p2) to N actors across
 * sides. It owns: the turn scheduler, explicit-target action resolution, the faithful
 * (ported) deterministic damage formula, team/last-standing win-check, party scaling,
 * and a deterministic auto-run used for async resolution + the settle recompute.
 *
 * DETERMINISM (Decision 2): no Math.random / Date.now anywhere; the seeded RNG is
 * threaded explicitly and used ONLY for AI tie-breaking — damage is a pure function of
 * stats (matching PvP, which has no damage RNG). Same (session, seed) → identical run.
 *
 * V1 SCOPE (faithful core): move / basic-attack / single-target jutsu damage, the
 * scaledEp × EP_MULTIPLIER × statFactor formula + armor DR pool, side-based rounds,
 * team win-check + defeat/protect/reach objectives, party-scaled enemy HP.
 * DEFERRED to Phase 1b/3 (additive layers, documented in the plan): the full tag/status
 * system (Wound/Poison/Reflect/Absorb/Lifesteal/Pierce/Stun-on-cast), AOE, weather/terrain
 * mults, chakra/stamina resource costs, interleaved boss-interrupt turns, boss-phase
 * mechanics, and the kill-adds-first / break-objective / defeat-all-then-boss gating
 * (these currently resolve as "all enemies dead"; the v1 catalog ships none of them).
 */
const _sim_js_1 = require("./_sim.js");
const _aoe_js_1 = require("../pvp/_aoe.js");
const move_js_1 = require("../pvp/move.js");
const _tags_js_1 = require("../pvp/_tags.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
const _tower_session_js_1 = require("./_tower-session.js");
// ─── Constants (ported from api/pvp/move.ts, verified @ 586f0560) ────────────
exports.BASE_AP = 100;
exports.MAX_ACTIONS = 5;
exports.MAX_ROUNDS = 25;
exports.STUN_AP_PENALTY = 40;
exports.MOVE_AP = 30;
exports.BASIC_ATTACK_AP = 40;
exports.K_DR = 0.5;
exports.JUTSU_MAX_LEVEL = 50;
exports.MASTERY_MIN_DAMAGE_FRAC = 0.3;
// ─── Hex geometry (generalized to arbitrary width/height; mirrors move.ts) ───
function xy(pos, w) { return { x: pos % w, y: Math.floor(pos / w) }; }
function posFromXY(x, y, w, h) {
    if (x < 0 || x >= w || y < 0 || y >= h)
        return -1;
    return y * w + x;
}
function towerNeighbors(pos, w, h) {
    const { x, y } = xy(pos, w);
    const even = x % 2 === 0;
    const deltas = even
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas.map(([dx, dy]) => posFromXY(x + dx, y + dy, w, h)).filter(n => n >= 0);
}
function occupantAt(session, tile, ignoreId) {
    return session.actors.find(a => a.hp > 0 && a.pos === tile && a.id !== ignoreId);
}
function isTileBlocked(session, tile, ignoreId) {
    if (session.map.blockedTiles.includes(tile))
        return true;
    return !!occupantAt(session, tile, ignoreId);
}
// Greedy one-step move toward `to`, avoiding blocked/occupied tiles. Deterministic
// (ties broken by lowest tile index). Returns `from` if no step improves distance.
function nextStepToward(session, from, to, ignoreId) {
    const w = session.map.width;
    const here = (0, _aoe_js_1.hexDistance)(from, to, w);
    let best = from;
    let bestD = here;
    for (const n of towerNeighbors(from, w, session.map.height).sort((a, b) => a - b)) {
        if (isTileBlocked(session, n, ignoreId))
            continue;
        const d = (0, _aoe_js_1.hexDistance)(n, to, w);
        if (d < bestD) {
            bestD = d;
            best = n;
        }
    }
    return best;
}
// ─── Damage (faithful port of resolveBaseDamage core; deterministic) ─────────
function getOffense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuOffense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuOffense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuOffense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function getDefense(stats, type) {
    if (type === 'Taijutsu')
        return (stats.taijutsuDefense ?? 0) + (stats.strength ?? 0) + (stats.speed ?? 0);
    if (type === 'Bukijutsu')
        return (stats.bukijutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.strength ?? 0);
    if (type === 'Genjutsu')
        return (stats.genjutsuDefense ?? 0) + (stats.intelligence ?? 0) + (stats.willpower ?? 0);
    return (stats.ninjutsuDefense ?? 0) + (stats.willpower ?? 0) + (stats.speed ?? 0);
}
function clampMastery(n) { return Math.max(0, Math.min(exports.JUTSU_MAX_LEVEL, Number(n) || 0)); }
// Utility jutsu = zero DIRECT damage (status/buff/debuff only — its value is its tags).
// Ported verbatim from api/pvp/move.ts isZeroDamageFortyApJutsu: prefer the explicit
// `isUtility` flag, else the legacy 40-AP convention (synthesized weapon/item ids exempt).
// NOTE: the tag layer is deferred (Phase 3) — so a utility jutsu currently lands no effect
// in towers; this guard at least stops it dealing phantom damage.
function isZeroDamageUtility(jutsu) {
    if (jutsu.isUtility === true)
        return true;
    if (jutsu.isUtility === false)
        return false;
    const id = String(jutsu.id ?? '');
    return jutsu.ap === 40 && id !== 'basic-attack' && !id.startsWith('item-');
}
function computeDamage(attacker, defender, jutsu, masteryLevel) {
    if (isZeroDamageUtility(jutsu))
        return 0;
    const ep = Number(jutsu.effectPower ?? 20);
    const epAtMax = ep + exports.JUTSU_MAX_LEVEL * 0.2;
    const masteryFrac = exports.MASTERY_MIN_DAMAGE_FRAC + (1 - exports.MASTERY_MIN_DAMAGE_FRAC) * (clampMastery(masteryLevel) / exports.JUTSU_MAX_LEVEL);
    const scaledEp = Math.max(0, epAtMax * masteryFrac);
    const type = String(jutsu.type ?? 'Taijutsu');
    const offStats = attacker.character.stats ?? {};
    const defStats = defender.character.stats ?? {};
    const sf = (0, _sim_js_1.statFactor)(getOffense(offStats, type), getDefense(defStats, type));
    const bloodlineMult = Math.max(1, Number(attacker.character.bloodlineMult ?? 1));
    const itemDamageMult = 1 + Math.max(0, Number(attacker.character.itemDamagePct ?? 0)) / 100;
    // Party-scale on enemy damage (set by applyPartyScaling for smaller parties; 1 otherwise).
    const partyDmgScale = Math.max(0, Number(attacker.character.towerDmgScale ?? 1));
    const baseDmg = Math.max(0, Math.floor(scaledEp * _sim_js_1.EP_MULTIPLIER * sf * bloodlineMult * itemDamageMult * partyDmgScale));
    // Armor DR pool (status DR is the deferred tag layer): effectiveDR = raw/(raw+K_DR).
    const armorRawDR = (defender.character.armorRawDR != null)
        ? Math.min(1.5, Math.max(0, Number(defender.character.armorRawDR)))
        : Math.max(0, 1 - Math.min(1.0, Math.max(0.25, Number(defender.character.armorFactor ?? 1.0))));
    const effectiveDR = armorRawDR > 0 ? armorRawDR / (armorRawDR + exports.K_DR) : 0;
    return Math.max(0, Math.floor(baseDmg * (1 - effectiveDR)));
}
// ─── Positional battlefield features (deterministic; position-based) ─────────
// A light tactical layer (a couple tiles per floor): pylons boost/weaken an
// element for a unit attacking FROM the tile, wards reduce damage TAKEN on the
// tile, hazards chip a unit standing on the tile at round end. All are pure
// functions of position + the floor's feature list — no RNG, no wall-clock — so
// the settle recompute reproduces them byte-for-byte. Floors without features
// (map.features undefined/empty) pay nothing here.
function mapFeatures(session) {
    return session.map.features ?? [];
}
/** Element boost/weaken for an attacker standing on a pylon tile. 1 when none apply. */
function pylonAttackMult(session, attacker, jutsu) {
    const el = String(jutsu.element ?? 'None');
    if (el === 'None' || !el)
        return 1; // basic attacks + non-elemental jutsu ignore pylons
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'pylon' || !f.tiles.includes(attacker.pos))
            continue;
        if (el === f.element)
            mult *= 1 + f.percent / 100;
        else if (el === f.weakenElement)
            mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Damage-taken reduction for a defender standing on a ward tile. 1 when none apply. */
function wardDefendMult(session, target) {
    let mult = 1;
    for (const f of mapFeatures(session)) {
        if (f.kind === 'ward' && f.tiles.includes(target.pos))
            mult *= 1 - f.percent / 100;
    }
    return Math.max(0, mult);
}
/** Round-end chip to every living unit standing on a hazard tile. */
function applyRoundHazards(session) {
    for (const f of mapFeatures(session)) {
        if (f.kind !== 'hazard')
            continue;
        for (const a of session.actors) {
            if (a.hp <= 0 || !f.tiles.includes(a.pos))
                continue;
            const dmg = Math.max(1, Math.floor((a.maxHp * f.percent) / 100));
            a.hp = Math.max(0, a.hp - dmg);
            session.log.push(`${a.name} takes ${dmg} from ${f.label ?? 'the hazard'} (${a.hp}/${a.maxHp}).`);
        }
    }
}
// ─── Boss mechanics (deterministic; tower-only) ──────────────────────────────
// Each boss has a signature mechanic that makes the fight distinct + tough. These are
// pure functions of the session state (no RNG / wall-clock), so settle reproduces them.
/** Enrage stacks ramp the boss's OUTGOING damage (+35% per stack). */
function attackerEnrageMult(attacker) {
    const e = Number(attacker.character.enrage ?? 0);
    return e > 0 ? 1 + 0.35 * e : 1;
}
/** A 'bulwark' boss takes HALF the damage while any of its guards (other enemies) live. */
function bulwarkMult(session, target) {
    if (String(target.character.mechanic ?? '') !== 'bulwark')
        return 1;
    const guardsAlive = session.actors.some(a => a.side === 'enemy' && a.id !== target.id && a.hp > 0);
    return guardsAlive ? 0.5 : 1;
}
/** Spawn the boss's reinforcements on free tiles around it (summon mechanic). */
function summonAdds(session) {
    const id = session.phaseState.bossId;
    const boss = id ? (0, _tower_session_js_1.getActor)(session, id) : undefined;
    if (!boss)
        return;
    const tpl = boss.character.summonTemplate;
    if (!tpl)
        return;
    const count = Math.max(1, Number(boss.character.summonCount ?? 2));
    const w = session.map.width, h = session.map.height;
    const occupied = new Set(session.actors.filter(a => a.hp > 0).map(a => a.pos));
    const blocked = new Set(session.map.blockedTiles);
    const scale = Math.max(0, Number(boss.character.towerDmgScale ?? 1)); // adds inherit the boss's party scaling
    let n = session.actors.filter(a => a.id.startsWith('add-')).length;
    let added = 0;
    for (const tile of towerNeighbors(boss.pos, w, h)) {
        if (added >= count)
            break;
        if (occupied.has(tile) || blocked.has(tile))
            continue;
        const hp = Math.max(1, Math.round(Number(tpl.hp ?? 300) * (scale < 1 ? scale : 1)));
        session.actors.push({
            id: `add-${n++}`, side: 'enemy', name: tpl.name ?? 'Add', ownerSlug: null, ai: true,
            hp, maxHp: hp, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            shield: 0, statuses: [], cooldowns: {}, pos: tile,
            character: { specialty: tpl.specialty ?? 'Taijutsu', stats: { ...(tpl.stats ?? {}) }, visual: tpl.visual ?? 'bandit', ...(scale < 1 ? { towerDmgScale: scale } : {}) },
        });
        occupied.add(tile);
        added++;
    }
    if (added > 0)
        session.log.push(`${boss.name} summons ${added} reinforcement${added !== 1 ? 's' : ''}!`);
}
/** Fired when the boss crosses an HP-phase gate. */
function applyBossPhaseMechanic(session, boss) {
    const m = String(boss.character.mechanic ?? '');
    if (m === 'enrage') {
        boss.character.enrage = Number(boss.character.enrage ?? 0) + 1;
        session.log.push(`${boss.name} enrages — its blows hit harder!`);
    }
    else if (m === 'summon') {
        summonAdds(session);
    }
    // 'bulwark' is passive (damage reduction while guards live); 'regen' fires per round.
}
/** Per-round heal for a 'regen' boss (7% of max HP). */
function applyBossRegen(session) {
    const id = session.phaseState.bossId;
    const boss = id ? (0, _tower_session_js_1.getActor)(session, id) : undefined;
    if (!boss || boss.hp <= 0 || String(boss.character.mechanic ?? '') !== 'regen')
        return;
    const heal = Math.max(1, Math.floor(boss.maxHp * 0.07));
    const before = boss.hp;
    boss.hp = Math.min(boss.maxHp, boss.hp + heal);
    if (boss.hp > before)
        session.log.push(`${boss.name} regenerates ${boss.hp - before} HP.`);
}
// ─── Targeting / sides ───────────────────────────────────────────────────────
function hostileSidesFor(side) {
    // Squad fights enemies; enemies fight squad + the protected npc.
    return side === 'squad' ? ['enemy'] : ['squad', 'npc'];
}
function opponentsOf(session, actor) {
    const sides = hostileSidesFor(actor.side);
    return session.actors.filter(a => a.hp > 0 && sides.includes(a.side));
}
function nearestOpponent(session, actor) {
    const w = session.map.width;
    let best;
    let bestD = Infinity;
    for (const o of opponentsOf(session, actor).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
        const d = (0, _aoe_js_1.hexDistance)(actor.pos, o.pos, w);
        if (d < bestD) {
            bestD = d;
            best = o;
        }
    }
    return best;
}
// ─── Loadout helpers ─────────────────────────────────────────────────────────
function actorSpecialty(actor) {
    const s = String(actor.character.specialty ?? 'Taijutsu');
    return ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'].includes(s) ? s : 'Taijutsu';
}
function findJutsu(actor, jutsuId) {
    const list = actor.character.jutsu;
    if (!Array.isArray(list))
        return undefined;
    return list.find(j => j && j.id === jutsuId);
}
function normalizeSlot(slot) {
    if (slot === 'weapon')
        return 'hand';
    if (slot === 'armor')
        return 'body';
    if (slot === 'accessory')
        return 'aura';
    return slot ?? '';
}
/** The actor's equipped item matching `itemId` (or the first equipped, if unspecified).
 *  Mirrors api/pvp/move.ts equippedPvpItem: only items in an `equipment` slot count. */
function equippedItem(actor, itemId) {
    const items = actor.character.pvpItems ?? [];
    const equipment = actor.character.equipment ?? {};
    const equippedIds = new Set(Object.values(equipment).filter((id) => Boolean(id)));
    return items.find(it => Boolean(it.id) && equippedIds.has(it.id) && (!itemId || it.id === itemId)) ?? null;
}
// ─── PvP-engine reuse: full tag/status combat via api/pvp/move.ts applyJutsu ──
// A TowerActor is structurally a PvpFighter superset (same name/hp/chakra/stamina/
// shield/statuses/character/pos, and the SAME PvpStatus shape). So instead of
// re-implementing the intricate, load-bearing tag pipeline (Heal/Shield/Pierce/Stun/
// Poison/Drain/Absorb/Reflect/Lifesteal/IDG/IDT/DDG/DDT/Wound/Recoil/…), the tower
// adapts each attacker→target pair to PvpFighters and calls the EXACT PvP resolver.
// applyJutsu is deterministic (no RNG / wall-clock) so the settle recompute still
// reproduces a run byte-for-byte. Positional tower features (pylons/wards/enrage/
// bulwark/party-scale) are folded into applyJutsu's `wMult`; terrain via its `biome`.
function actorToFighter(a) {
    return {
        name: a.name, hp: a.hp, maxHp: a.maxHp, chakra: a.chakra, maxChakra: a.maxChakra,
        stamina: a.stamina, maxStamina: a.maxStamina, shield: a.shield,
        statuses: a.statuses.map(s => ({ ...s })), character: a.character, pos: a.pos,
    };
}
function writeBackFighter(a, f) {
    a.hp = Math.max(0, Math.min(a.maxHp, Math.floor(f.hp)));
    a.chakra = Math.max(0, Math.floor(f.chakra));
    a.stamina = Math.max(0, Math.floor(f.stamina));
    a.shield = Math.max(0, Math.floor(f.shield));
    a.statuses = f.statuses;
    // pos is intentionally NOT written back: Push/Pull/Barrier in applyJutsu use the
    // PvP grid, and the tower owns positioning — so those displacement tags are inert.
}
/** Resolve one jutsu/weapon/attack from `actor` onto `target` (target===actor for a
 *  self-cast buff/heal) through the PvP resolver, with the tower env multiplier folded in. */
function runJutsu(session, actor, target, jutsu, wMult) {
    const selfCast = actor.id === target.id;
    const sf = actorToFighter(actor);
    const of = selfCast ? actorToFighter(actor) : actorToFighter(target);
    const res = (0, move_js_1.applyJutsu)(sf, of, jutsu, wMult, String(session.map.biome ?? 'central'), session.round);
    writeBackFighter(actor, res.self);
    if (!selfCast)
        writeBackFighter(target, res.opponent);
    session.log.push(...res.lines);
}
// Area radius for an AOE / ground / displacement jutsu (0 = single-target). Bloodline/
// creator jutsu carry these methods; the built-in catalog is all SINGLE. Ground-target
// + Move jutsu resolve as an area burst centred on the struck foe (the tower owns
// positioning, so the zone is applied immediately rather than placed on a tile).
function jutsuAreaRadius(jutsu) {
    const m = String(jutsu.method ?? 'SINGLE');
    if (m === 'AOE_SPIRAL')
        return 2;
    if (m === 'AOE_CIRCLE' || m === 'INSTANT_EFFECT' || m === 'AOE_LINE')
        return 1;
    if (String(jutsu.target ?? '') === 'EMPTY_GROUND')
        return 1;
    if (Array.isArray(jutsu.tags) && jutsu.tags.some(t => t?.name === 'Move'))
        return 1;
    return 0;
}
/** Splash an AOE jutsu to every OTHER hostile in the blast (opponent-effects only, so the
 *  caster's heal/buff isn't re-applied per victim). Returns the names caught. */
function applyAoeSplash(session, actor, primary, jutsu, wMult, radius) {
    const area = new Set((0, _aoe_js_1.filledDiskTiles)(primary.pos, radius, session.map.width, session.map.height));
    const caught = [];
    const biome = String(session.map.biome ?? 'central');
    for (const e of session.actors) {
        if (e.id === primary.id || e.hp <= 0 || !hostileSidesFor(actor.side).includes(e.side) || !area.has(e.pos))
            continue;
        const res = (0, move_js_1.applyJutsu)(actorToFighter(actor), actorToFighter(e), jutsu, wMult, biome, session.round);
        writeBackFighter(e, res.opponent); // only the victim — caster effects already applied on the primary
        caught.push(e.name);
    }
    return caught;
}
// ─── Persistent ground-effect zones (EMPTY_GROUND jutsu placed on a tile) ─────
// A faithful tower port of PvP's ground zones: a tile-targeted jutsu lays a 2-round
// zone carrying its ground-eligible tags (Decrease Damage Given / Recoil / Poison);
// any HOSTILE standing in the zone re-suffers the tags each round (reusing the EXACT
// PvP applyGroundEffectToFighter), then the zone ticks down. Deterministic (no RNG/
// clock — the id is derived from round + caster + jutsu so settle reproduces it).
function towerGroundTags(tags) {
    if (!Array.isArray(tags))
        return [];
    return tags
        .filter(t => t && typeof t.name === 'string')
        .map(t => ({ ...t, name: (0, _tags_js_1.canonicalTagName)(t.name) }))
        .filter(t => _tags_js_1.GROUND_EFFECT_TAGS.has(t.name));
}
function groundZoneTiles(center, w, h) {
    return [center, ...towerNeighbors(center, w, h)];
}
/** Living actors a zone affects — the HOSTILES of the side that cast it (squad→'p1'). */
function groundZoneTargets(session, effect) {
    const victimSides = effect.owner === 'p1' ? ['enemy'] : ['squad', 'npc'];
    return session.actors.filter(a => a.hp > 0 && victimSides.includes(a.side));
}
function applyZoneToUnits(session, effect) {
    for (const a of groundZoneTargets(session, effect)) {
        if (!effect.tiles.includes(a.pos))
            continue;
        const r = (0, move_js_1.applyGroundEffectToFighter)(actorToFighter(a), effect, session.round);
        a.statuses = r.fighter.statuses;
        if (r.lines.length)
            session.log.push(...r.lines);
    }
}
/** Place a ground zone at `tile` from a ground-target (EMPTY_GROUND) jutsu, and bite anyone
 *  already standing in it. Returns false if the jutsu carries no ground-eligible tags. */
function layGroundZone(session, actor, jutsuId, jutsu, tile) {
    const tags = towerGroundTags(jutsu.tags);
    if (!tags.length)
        return false;
    const effect = {
        id: `gz-${session.round}-${actor.id}-${jutsuId}`,
        owner: actor.side === 'squad' ? 'p1' : 'p2',
        name: jutsu.name ?? 'Ground Effect',
        tiles: groundZoneTiles(tile, session.map.width, session.map.height),
        rounds: 2,
        tags,
    };
    session.groundEffects = [...(session.groundEffects ?? []), effect];
    session.log.push(`${actor.name} lays ${effect.name} across ${effect.tiles.length} tiles for 2 rounds.`);
    applyZoneToUnits(session, effect);
    return true;
}
/** Round-end: re-apply every live zone to units standing in it, then expire spent zones. */
function applyRoundGroundEffects(session) {
    for (const effect of session.groundEffects ?? [])
        applyZoneToUnits(session, effect);
    session.groundEffects = (0, move_js_1.tickGroundEffects)(session.groundEffects);
}
// Shared resolution for attack / jutsu / weapon (and self-cast jutsu). Folds the
// positional tower multipliers into applyJutsu's wMult (terrain handled by its biome
// arg), then deducts AP/actions and advances boss phases + the win-check. Resource
// (chakra/stamina) + cooldown bookkeeping is the caller's job (it differs per action).
function resolveHit(session, floor, actor, target, jutsu, cost) {
    const selfCast = actor.id === target.id;
    const wMult = selfCast ? 1 : (pylonAttackMult(session, actor, jutsu) * wardDefendMult(session, target)
        * attackerEnrageMult(actor) * bulwarkMult(session, target)
        * Math.max(0, Number(actor.character.towerDmgScale ?? 1)));
    const verb = jutsu.id === 'basic-attack' ? 'attacks'
        : jutsu.id === 'weapon' ? `strikes with ${jutsu.name ?? 'a weapon'}`
            : `uses ${jutsu.name ?? 'a jutsu'}`;
    session.log.push(selfCast ? `${actor.name} ${verb}.` : `${actor.name} ${verb} → ${target.name}.`);
    runJutsu(session, actor, target, jutsu, wMult);
    // AOE / ground / Move jutsu also strike the other hostiles in the blast radius.
    const radius = selfCast ? 0 : jutsuAreaRadius(jutsu);
    if (radius > 0) {
        const caught = applyAoeSplash(session, actor, target, jutsu, wMult, radius);
        if (caught.length)
            session.log.push(`The blast also catches ${caught.join(', ')}.`);
    }
    session.activeAp -= cost;
    session.actionsThisTurn += 1;
    tickBossPhases(session);
    checkTowerWinner(session, floor);
}
// Round-end: tick Wound/Poison/Drain DoTs and expire statuses for every living actor,
// reusing the EXACT PvP helpers so timing/mitigation match the live game.
function applyRoundStatusTicks(session) {
    for (const a of session.actors) {
        if (a.hp <= 0)
            continue;
        const dot = (0, move_js_1.applyDoTs)(actorToFighter(a), session.round);
        a.hp = Math.max(0, Math.min(a.maxHp, Math.floor(dot.fighter.hp)));
        a.chakra = Math.max(0, Math.floor(dot.fighter.chakra));
        if (dot.lines.length)
            session.log.push(...dot.lines);
        a.statuses = (0, move_js_1.tickStatuses)(actorToFighter(a), session.round).statuses;
    }
}
// ─── Turn scheduler (side-based rounds; interleaved boss-interrupt is Phase 3) ─
function rebuildTurnQueue(session) {
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const squad = (0, _tower_session_js_1.livingOnSide)(session, 'squad').sort(byId).map(a => a.id);
    const enemy = (0, _tower_session_js_1.livingOnSide)(session, 'enemy').sort(byId).map(a => a.id);
    session.turnQueue = [...squad, ...enemy]; // npc actors are passive in v1 (protect targets)
}
function canAct(session, cost) {
    return session.activeAp >= cost && session.actionsThisTurn < exports.MAX_ACTIONS;
}
// Round-aware: a Stun applied THIS round (activeRound = round+1) defers to next turn,
// matching PvP — so an earlier actor stunning a later one doesn't rob the same round.
function isStunActive(s, round) {
    return (s.name === 'Stun' || s.name === 'Stunned') && (s.activeRound === undefined || s.activeRound <= round);
}
function isStunned(actor, round) {
    return actor.statuses.some(s => isStunActive(s, round));
}
/** Tick down an actor's jutsu cooldowns at the START of their turn (mirrors PvP's
 *  per-caster tickCooldowns). Removes lapsed entries so the map stays small. */
function tickCooldowns(actor) {
    for (const k of Object.keys(actor.cooldowns)) {
        const n = (actor.cooldowns[k] ?? 0) - 1;
        if (n > 0)
            actor.cooldowns[k] = n;
        else
            delete actor.cooldowns[k];
    }
}
function refreshAp(session) {
    const actor = (0, _tower_session_js_1.activeActor)(session);
    if (actor)
        tickCooldowns(actor);
    if (actor && isStunned(actor, session.round)) {
        // Stun costs AP once and is CONSUMED at the start of the penalized turn (mirrors
        // api/pvp/move.ts:893-902) — never re-penalizing a lingering Stun every round.
        session.activeAp = Math.max(0, exports.BASE_AP - exports.STUN_AP_PENALTY);
        actor.statuses = actor.statuses.filter(s => !isStunActive(s, session.round));
    }
    else {
        session.activeAp = exports.BASE_AP;
    }
    session.actionsThisTurn = 0;
}
function startRound(session) {
    rebuildTurnQueue(session);
    session.activeIndex = 0;
    refreshAp(session);
}
// ─── Win-check + objectives ──────────────────────────────────────────────────
function bossDead(session) {
    const id = session.phaseState.bossId;
    if (!id)
        return false;
    const boss = (0, _tower_session_js_1.getActor)(session, id);
    return !!boss && boss.hp <= 0;
}
function squadWinsByObjective(session, floor) {
    switch (floor.objective) {
        case 'defeat-boss':
            // If a boss is resolved, the boss must die; if a floor was misconfigured with no
            // bossId, fall back to a full wipe so a genuine clear is never scored as a loss.
            return session.phaseState.bossId ? bossDead(session) : !(0, _tower_session_js_1.isSideAlive)(session, 'enemy');
        case 'reach-tile':
            // Robust to spawn-on-goal + (future) displacement: a LIVING squad actor on the
            // goal tile wins, not just one that *moved* there this turn.
            return typeof floor.goalTile === 'number'
                ? session.actors.some(a => a.side === 'squad' && a.hp > 0 && a.pos === floor.goalTile)
                : !!session.objectiveState.reachedGoal;
        case 'survive':
            return (session.objectiveState.roundsSurvived ?? 0) >= floor.roundBudget;
        case 'protect-npc':
        case 'kill-escort':
            return !(0, _tower_session_js_1.isSideAlive)(session, 'enemy') && (0, _tower_session_js_1.isSideAlive)(session, 'npc');
        // defeat-all / defeat-all-then-boss / kill-adds-first / break-objective
        default:
            return !(0, _tower_session_js_1.isSideAlive)(session, 'enemy');
    }
}
function objectiveFailed(session, floor) {
    if (floor.objective === 'protect-npc' || floor.objective === 'kill-escort') {
        // npc(s) existed and are all down
        return session.actors.some(a => a.side === 'npc') && !(0, _tower_session_js_1.isSideAlive)(session, 'npc');
    }
    return false;
}
function checkTowerWinner(session, floor) {
    if (session.status !== 'active')
        return;
    if (!(0, _tower_session_js_1.isSideAlive)(session, 'squad')) {
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Squad wiped — floor failed.');
        return;
    }
    if (objectiveFailed(session, floor)) {
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Objective failed.');
        return;
    }
    if (squadWinsByObjective(session, floor)) {
        session.status = 'done';
        session.winner = 'squad';
        session.objectiveState.completed = true;
        session.log.push(`Floor ${floor.id} cleared!`);
    }
}
// Move crossed boss HP-phase thresholds from pending → triggered (hook for Phase 3 mechanics).
function tickBossPhases(session) {
    const id = session.phaseState.bossId;
    if (!id)
        return;
    const boss = (0, _tower_session_js_1.getActor)(session, id);
    if (!boss || boss.maxHp <= 0)
        return;
    const pct = (boss.hp / boss.maxHp) * 100;
    while (session.phaseState.pendingPhases.length && pct <= session.phaseState.pendingPhases[0]) {
        const t = session.phaseState.pendingPhases.shift();
        session.phaseState.triggeredPhases.push(t);
        session.log.push(`${boss.name} enters a new phase (${t}% HP).`);
        applyBossPhaseMechanic(session, boss); // enrage / summon fire at each gate
    }
}
// ─── Action application ──────────────────────────────────────────────────────
function applyAction(session, floor, action, rng) {
    void rng; // reserved: AI tie-breaking / future variance — damage stays deterministic
    if (session.status !== 'active')
        return { applied: false, reason: 'session-done' };
    const actor = (0, _tower_session_js_1.activeActor)(session);
    if (!actor || actor.id !== action.actorId)
        return { applied: false, reason: 'not-your-turn' };
    if (actor.hp <= 0)
        return { applied: false, reason: 'down' };
    if (action.type === 'wait')
        return { applied: true };
    if (action.type === 'move') {
        if (!canAct(session, exports.MOVE_AP))
            return { applied: false, reason: 'cannot-act' };
        const w = session.map.width;
        if ((0, _aoe_js_1.hexDistance)(actor.pos, action.tile, w) !== 1)
            return { applied: false, reason: 'not-adjacent' };
        if (isTileBlocked(session, action.tile, actor.id))
            return { applied: false, reason: 'blocked' };
        actor.pos = action.tile;
        session.activeAp -= exports.MOVE_AP;
        session.actionsThisTurn += 1;
        if (actor.side === 'squad' && floor.objective === 'reach-tile' && typeof floor.goalTile === 'number' && actor.pos === floor.goalTile) {
            session.objectiveState.reachedGoal = true;
        }
        checkTowerWinner(session, floor);
        return { applied: true };
    }
    // ── weapon: a hit from the equipped hand/thrown weapon (real weaponEp/range/AP) ──
    if (action.type === 'weapon') {
        const item = equippedItem(actor, action.itemId);
        const slot = item ? normalizeSlot(item.slot) : '';
        if (!item || !['hand', 'thrown'].includes(slot))
            return { applied: false, reason: 'no-weapon' };
        const wCost = Math.max(0, Number(item.apCost ?? exports.BASIC_ATTACK_AP));
        if (!canAct(session, wCost))
            return { applied: false, reason: 'cannot-act' };
        const wTarget = (0, _tower_session_js_1.getActor)(session, action.targetId);
        if (!wTarget || wTarget.hp <= 0)
            return { applied: false, reason: 'no-target' };
        if (!hostileSidesFor(actor.side).includes(wTarget.side))
            return { applied: false, reason: 'friendly-fire' };
        const wRange = Math.max(1, Number(item.weaponRange ?? (slot === 'thrown' ? 4 : 1)));
        if ((0, _aoe_js_1.hexDistance)(actor.pos, wTarget.pos, session.map.width) > wRange)
            return { applied: false, reason: 'out-of-range' };
        // Thrown weapons spend from the sealed charge budget; hand weapons are reusable.
        if (slot === 'thrown') {
            const have = actor.itemCharges?.[item.id] ?? 0;
            if (have <= 0)
                return { applied: false, reason: 'out-of-ammo' };
            (actor.itemCharges ??= {})[item.id] = have - 1;
        }
        const weaponJutsu = {
            id: 'weapon', name: item.name ?? 'Weapon', type: 'Bukijutsu',
            isUtility: false, effectPower: Number(item.weaponEp ?? 15), ap: wCost, range: wRange,
            ...(Array.isArray(item.weaponTags) && item.weaponTags.length ? { tags: item.weaponTags } : {}),
        };
        resolveHit(session, floor, actor, wTarget, weaponJutsu, wCost);
        return { applied: true };
    }
    // ── self-cast jutsu (target: SELF) — heals/buffs resolve on the caster, no foe needed ──
    if (action.type === 'jutsu') {
        const jSelf = findJutsu(actor, action.jutsuId);
        if (jSelf && String(jSelf.target) === 'SELF') {
            const cost = Number(jSelf.ap ?? 40);
            const ck = Math.max(0, Number(jSelf.chakraCost ?? 0));
            const st = Math.max(0, Number(jSelf.staminaCost ?? 0));
            if ((actor.cooldowns[action.jutsuId] ?? 0) > 0)
                return { applied: false, reason: 'on-cooldown' };
            if (ck > 0 && actor.chakra < ck)
                return { applied: false, reason: 'no-chakra' };
            if (st > 0 && actor.stamina < st)
                return { applied: false, reason: 'no-stamina' };
            if (!canAct(session, cost))
                return { applied: false, reason: 'cannot-act' };
            resolveHit(session, floor, actor, actor, jSelf, cost);
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            if (Number(jSelf.cooldown ?? 0) > 0)
                actor.cooldowns[action.jutsuId] = Number(jSelf.cooldown);
            return { applied: true };
        }
    }
    // ── ground-target jutsu (target: EMPTY_GROUND) — place a persistent zone on a tile ──
    if (action.type === 'jutsu' && action.tile !== undefined) {
        const jg = findJutsu(actor, action.jutsuId);
        if (jg && String(jg.target) === 'EMPTY_GROUND') {
            const tile = Math.floor(action.tile);
            if (tile < 0 || tile >= session.map.width * session.map.height)
                return { applied: false, reason: 'bad-tile' };
            if (session.map.blockedTiles.includes(tile))
                return { applied: false, reason: 'blocked' };
            const range = Math.max(1, Number(jg.range ?? 1));
            if ((0, _aoe_js_1.hexDistance)(actor.pos, tile, session.map.width) > range)
                return { applied: false, reason: 'out-of-range' };
            const cost = Number(jg.ap ?? 40);
            const ck = Math.max(0, Number(jg.chakraCost ?? 0));
            const st = Math.max(0, Number(jg.staminaCost ?? 0));
            if ((actor.cooldowns[action.jutsuId] ?? 0) > 0)
                return { applied: false, reason: 'on-cooldown' };
            if (ck > 0 && actor.chakra < ck)
                return { applied: false, reason: 'no-chakra' };
            if (st > 0 && actor.stamina < st)
                return { applied: false, reason: 'no-stamina' };
            if (!canAct(session, cost))
                return { applied: false, reason: 'cannot-act' };
            if (!layGroundZone(session, actor, action.jutsuId, jg, tile))
                return { applied: false, reason: 'no-ground-tags' };
            actor.chakra = Math.max(0, actor.chakra - ck);
            actor.stamina = Math.max(0, actor.stamina - st);
            if (Number(jg.cooldown ?? 0) > 0)
                actor.cooldowns[action.jutsuId] = Number(jg.cooldown);
            session.activeAp -= cost;
            session.actionsThisTurn += 1;
            tickBossPhases(session);
            checkTowerWinner(session, floor);
            return { applied: true };
        }
    }
    // ── item: a self-targeted consumable (potion / combat item). Restore-only potions
    // refill chakra/stamina directly; everything else (Heal potions, self-buffs, smoke)
    // synthesizes a SELF jutsu and resolves through the PvP engine. Mirrors move.ts. ──
    if (action.type === 'item') {
        const item = equippedItem(actor, action.itemId);
        const slot = item ? normalizeSlot(item.slot) : '';
        if (!item || ['hand', 'thrown'].includes(slot))
            return { applied: false, reason: 'no-item' };
        const iCost = Math.max(0, Number(item.apCost ?? 35));
        if (!canAct(session, iCost))
            return { applied: false, reason: 'cannot-act' };
        const have = actor.itemCharges?.[item.id] ?? 0;
        if (have <= 0)
            return { applied: false, reason: 'out-of-item' };
        const restoreCk = Math.max(0, Number(item.restoreChakra ?? 0));
        const restoreSt = Math.max(0, Number(item.restoreStamina ?? 0));
        const itemTags = Array.isArray(item.weaponTags) && item.weaponTags.length ? item.weaponTags
            : item.weaponEffect ? [{ name: item.weaponEffect, percent: Number(item.weaponEffectValue ?? 0) }]
                : null;
        (actor.itemCharges ??= {})[item.id] = have - 1;
        if ((restoreCk > 0 || restoreSt > 0) && !itemTags) {
            // Pure restore potion — refill directly (skip the synth so it never heals HP via a default Heal tag).
            actor.chakra = Math.min(actor.maxChakra, actor.chakra + restoreCk);
            actor.stamina = Math.min(actor.maxStamina, actor.stamina + restoreSt);
            session.log.push(`${actor.name} uses ${item.name ?? 'a potion'} — restores ${restoreCk} chakra, ${restoreSt} stamina.`);
        }
        else {
            // Heal / self-buff consumable → self-cast jutsu (id 'item-' exempts the 40-AP utility rule).
            const itemJutsu = {
                id: `item-${item.id}`, name: item.name ?? 'Item', type: 'Ninjutsu', target: 'SELF',
                effectPower: Number(item.weaponEp ?? 10), ap: iCost, range: 0,
                tags: (itemTags ?? [{ name: 'Heal' }]),
            };
            session.log.push(`${actor.name} uses ${item.name ?? 'an item'}.`);
            runJutsu(session, actor, actor, itemJutsu, 1);
        }
        session.activeAp -= iCost;
        session.actionsThisTurn += 1;
        checkTowerWinner(session, floor);
        return { applied: true };
    }
    // attack / jutsu — need a living, hostile, in-range target
    const target = (0, _tower_session_js_1.getActor)(session, action.targetId ?? '');
    if (!target || target.hp <= 0)
        return { applied: false, reason: 'no-target' };
    if (!hostileSidesFor(actor.side).includes(target.side))
        return { applied: false, reason: 'friendly-fire' };
    const dist = (0, _aoe_js_1.hexDistance)(actor.pos, target.pos, session.map.width);
    let jutsu;
    let cost;
    let chakraCost = 0;
    let staminaCost = 0;
    if (action.type === 'attack') {
        // Basic attack stays resource-free (the always-available fallback; matches the AI's reliance on it).
        jutsu = { id: 'basic-attack', effectPower: 10, type: actorSpecialty(actor), ap: exports.BASIC_ATTACK_AP, range: 1 };
        cost = exports.BASIC_ATTACK_AP;
        if (dist > 1)
            return { applied: false, reason: 'out-of-range' };
    }
    else {
        const j = findJutsu(actor, action.jutsuId);
        if (!j)
            return { applied: false, reason: 'no-jutsu' };
        jutsu = j;
        cost = Number(j.ap ?? 40);
        chakraCost = Math.max(0, Number(j.chakraCost ?? 0));
        staminaCost = Math.max(0, Number(j.staminaCost ?? 0));
        const range = Math.max(1, Number(j.range ?? 1));
        if (dist > range)
            return { applied: false, reason: 'out-of-range' };
        // Resource + cooldown gating (real costs from the catalog jutsu — matches PvP).
        if ((actor.cooldowns[action.jutsuId] ?? 0) > 0)
            return { applied: false, reason: 'on-cooldown' };
        if (chakraCost > 0 && actor.chakra < chakraCost)
            return { applied: false, reason: 'no-chakra' };
        if (staminaCost > 0 && actor.stamina < staminaCost)
            return { applied: false, reason: 'no-stamina' };
    }
    if (!canAct(session, cost))
        return { applied: false, reason: 'cannot-act' };
    resolveHit(session, floor, actor, target, jutsu, cost);
    // Deduct chakra/stamina + arm the cooldown after a jutsu lands (basic attack is free).
    if (action.type === 'jutsu') {
        actor.chakra = Math.max(0, actor.chakra - chakraCost);
        actor.stamina = Math.max(0, actor.stamina - staminaCost);
        if (Number(jutsu.cooldown ?? 0) > 0)
            actor.cooldowns[action.jutsuId] = Number(jutsu.cooldown);
    }
    return { applied: true };
}
// ─── Turn advance ────────────────────────────────────────────────────────────
function endTurn(session, floor) {
    if (session.status !== 'active')
        return;
    let idx = session.activeIndex + 1;
    while (idx < session.turnQueue.length) {
        const a = (0, _tower_session_js_1.getActor)(session, session.turnQueue[idx]);
        if (a && a.hp > 0)
            break;
        idx++;
    }
    if (idx < session.turnQueue.length) {
        session.activeIndex = idx;
        refreshAp(session);
        return;
    }
    // round complete
    session.objectiveState.roundsSurvived = (session.objectiveState.roundsSurvived ?? 0) + 1;
    applyRoundGroundEffects(session); // re-apply persistent ground zones to units standing in them, then tick
    applyRoundStatusTicks(session); // bleed Wound/Poison/Drain + expire statuses (PvP DoT math)
    applyRoundHazards(session); // chip anyone standing on a hazard tile at round end
    applyBossRegen(session); // a 'regen' boss heals each round
    checkTowerWinner(session, floor);
    if (session.status !== 'active')
        return;
    if (session.round >= exports.MAX_ROUNDS) {
        // hard timeout: failed to clear in time (survive floors win above before reaching here)
        session.status = 'done';
        session.winner = 'enemy';
        session.objectiveState.failed = true;
        session.log.push('Round limit reached — floor failed.');
        return;
    }
    session.round += 1;
    startRound(session);
}
// ─── Deterministic AI policy (v1 — nearest-target; richer policy = P1.A3) ─────
function bestAffordableJutsu(session, actor, dist) {
    const list = actor.character.jutsu;
    if (!Array.isArray(list))
        return undefined;
    const opts = list
        .filter(j => j && typeof j.id === 'string')
        .filter(j => Math.max(1, Number(j.range ?? 1)) >= dist)
        .filter(j => canAct(session, Number(j.ap ?? 40)))
        // affordable: not on cooldown, enough chakra + stamina (mirrors the human gates)
        .filter(j => (actor.cooldowns[String(j.id)] ?? 0) <= 0)
        .filter(j => actor.chakra >= Math.max(0, Number(j.chakraCost ?? 0)) && actor.stamina >= Math.max(0, Number(j.staminaCost ?? 0)))
        // skip zero-damage utility + ground-placed jutsu — the AI casts straightforward damage
        .filter(j => Number(j.effectPower ?? 0) > 0 && String(j.target ?? '') !== 'EMPTY_GROUND')
        // deterministic: highest effectPower, ties by id
        .sort((a, b) => (Number(b.effectPower ?? 0) - Number(a.effectPower ?? 0)) || (String(a.id) < String(b.id) ? -1 : 1));
    return opts[0];
}
function pickAiAction(session, actor, rng) {
    void rng;
    const target = nearestOpponent(session, actor);
    if (!target)
        return { actorId: actor.id, type: 'wait' };
    const dist = (0, _aoe_js_1.hexDistance)(actor.pos, target.pos, session.map.width);
    const j = bestAffordableJutsu(session, actor, dist);
    if (j && j.id)
        return { actorId: actor.id, type: 'jutsu', jutsuId: j.id, targetId: target.id };
    if (dist <= 1 && canAct(session, exports.BASIC_ATTACK_AP))
        return { actorId: actor.id, type: 'attack', targetId: target.id };
    if (canAct(session, exports.MOVE_AP)) {
        const step = nextStepToward(session, actor.pos, target.pos, actor.id);
        if (step !== actor.pos)
            return { actorId: actor.id, type: 'move', tile: step };
    }
    return { actorId: actor.id, type: 'wait' };
}
// ─── Party scaling ───────────────────────────────────────────────────────────
// Scale enemy HP for a party smaller than the floor's balance baseline. Called by the
// encounter builder (start.ts, P1.B1) after enemies are built. Squad/npc untouched.
function applyPartyScaling(session, floor) {
    const factor = (0, _floor_catalog_js_1.partyScaleFactor)(session.partySize, (0, _floor_catalog_js_1.getFloorBalanceFor)(floor));
    if (factor >= 1)
        return;
    for (const a of session.actors) {
        if (a.side !== 'enemy')
            continue;
        // Idempotency guard: never double-scale (a settle recompute or accidental second
        // call must not weaken enemies further). towerDmgScale is the "already scaled" mark.
        if (a.character.towerDmgScale != null)
            continue;
        a.maxHp = (0, _floor_catalog_js_1.scaleEnemyStat)(a.maxHp, factor);
        a.hp = Math.min(a.hp, a.maxHp);
        // Enemy outgoing damage scales by the same factor (read by computeDamage).
        a.character.towerDmgScale = factor;
    }
}
// ─── Deterministic auto-run (async resolution + settle recompute) ────────────
// Drives every actor via the AI policy to a terminal state. Used when the whole floor
// is AI-resolved (async squads) and by settle.ts to recompute the clear from the seed.
function runTowerFloor(session, floor, rng) {
    if (session.turnQueue.length === 0)
        startRound(session);
    const GUARD = (exports.MAX_ROUNDS + 2) * (session.actors.length + 2) * (exports.MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = (0, _tower_session_js_1.activeActor)(session);
        if (!actor || actor.hp <= 0 || actor.side === 'npc') {
            endTurn(session, floor);
            continue;
        }
        let safety = 0;
        while (session.status === 'active' && safety++ <= exports.MAX_ACTIONS) {
            const action = pickAiAction(session, actor, rng);
            if (action.type === 'wait')
                break;
            const res = applyAction(session, floor, action, rng);
            if (!res.applied)
                break;
        }
        if (session.status === 'active')
            endTurn(session, floor);
    }
    checkTowerWinner(session, floor);
    return session;
}
// Live-mode driver: advance AI actors' turns until it is a HUMAN's turn (ai === false) or
// the floor resolves. Used by api/towers/action.ts after a human submits a turn-ending
// action, so the human only ever sees their own turns. Deterministic (seeded rng).
function runAiUntilHuman(session, floor, rng) {
    if (session.turnQueue.length === 0)
        startRound(session);
    const GUARD = (exports.MAX_ROUNDS + 2) * (session.actors.length + 2) * (exports.MAX_ACTIONS + 2) + 256;
    let guard = 0;
    while (session.status === 'active' && guard++ < GUARD) {
        const actor = (0, _tower_session_js_1.activeActor)(session);
        if (actor && actor.ai === false && actor.hp > 0)
            break; // a live human's turn — stop
        if (!actor || actor.hp <= 0 || actor.side === 'npc') {
            endTurn(session, floor);
            continue;
        }
        let safety = 0;
        while (session.status === 'active' && safety++ <= exports.MAX_ACTIONS) {
            const a = pickAiAction(session, actor, rng);
            if (a.type === 'wait')
                break;
            if (!applyAction(session, floor, a, rng).applied)
                break;
        }
        if (session.status === 'active')
            endTurn(session, floor);
    }
}

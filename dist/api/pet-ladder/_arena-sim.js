"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCROLL_FIRST_SPAWN = exports.ARENA_Y = exports.ARENA_X = exports.WIN_SCORE = exports.MAX_SECONDS = exports.ARENA_TPS = void 0;
exports.runPetArenaMatch = runPetArenaMatch;
const _fullmask_js_1 = require("./_fullmask.js");
const _pet_gear_js_1 = require("./_pet-gear.js");
exports.ARENA_TPS = 30;
exports.MAX_SECONDS = 300; // 5-min safety cap (tactical fights run ~2–4 min)
const MAX_TICKS = exports.ARENA_TPS * exports.MAX_SECONDS;
exports.WIN_SCORE = 5; // first team to 5 SCROLL CAPTURES wins — kills don't score (purely tactical)
exports.ARENA_X = 14.0, exports.ARENA_Y = 7.5;
// ── Pacing ───────────────────────────────────────────────────────────────────
// Fights should read as deliberate tactical exchanges (~2–5 min), not a 40-second
// melee where pets blink and die. The main lever is TIME-TO-KILL: HP scaled up +
// one slower swing/sec, so engagements last long enough to SEE a defender peel, a
// sage sustain, an assassin dive. Plus a periodic (~0.5 s) decision cadence so pets
// COMMIT instead of darting, meaningful deaths (longer respawn = fewer pets thrash
// at once), and a late scroll as a recurring objective beat.
const TTK_HP_MUL = 2.4; // ×effective HP → ~4× time-to-kill (relative role balance unchanged)
const ATTACK_CD = Math.round(exports.ARENA_TPS * 1.0); // one basic swing/sec (was 0.55 s — too frantic to follow)
const DECISION_TICKS = 16; // re-decide ~every 0.53 s; reuse the plan between → deliberate, smooth
exports.SCROLL_FIRST_SPAWN = exports.ARENA_TPS * 20; // first scroll at 20 s — an early objective beat the squads converge on
const SCROLL_ANTICIPATE = 7; // seconds before a spawn that pets start pre-positioning toward the centre
const SCROLL_RESPAWN = exports.ARENA_TPS * 22; // re-spawn 22 s after capture/reset — a brisk cycle so a race to 5 captures resolves
const SCROLL_CHANNEL = exports.ARENA_TPS * 2; // 2 s channel to pick up
const SCROLL_DROP_LIFE = exports.ARENA_TPS * 10; // a dropped scroll resets after 10 s
const RESPAWN_TICKS = exports.ARENA_TPS * 7; // 7 s respawn — a kill earns a real window, fewer pets churning
const PICKUP_RANGE = 1.4; // how close you must be to channel
const BASE_SCORE_RANGE = 1.8; // carrier scores within this of its base
const CARRIER_SLOW = 0.85; // −15% speed while carrying
const SPEED_CRIT_DIVISOR = 600; // ownSpeed/this → bonus crit; gives Speed a payoff past the move-speed cap
const ROLE_CFG = {
    // Tanky frontline — hard to kill, low damage, short range, taunts + shields.
    defender: { hpMul: 1.75, defMul: 1.7, dmgMul: 0.62, spdMul: 0.82, neutral: 1.5, atkRange: 1.5, crit: 0.05, ability: "guard", abilityCd: 6, abilityCost: 35 },
    // Sustained pressure — chases, marks targets for bonus damage over time.
    tracker: { hpMul: 1.05, defMul: 1.05, dmgMul: 1.0, spdMul: 1.06, neutral: 3.4, atkRange: 4.0, crit: 0.1, ability: "mark", abilityCd: 4, abilityCost: 28 },
    // Fragile burst — dashes onto squishies/carriers, high crit, low durability.
    assassin: { hpMul: 0.7, defMul: 0.68, dmgMul: 1.55, spdMul: 1.26, neutral: 2.2, atkRange: 1.6, crit: 0.32, ability: "assassinate", abilityCd: 5, abilityCost: 40 },
    // Support — heals/shields allies, weak offense, sits at range, never frontlines.
    sage: { hpMul: 0.85, defMul: 0.95, dmgMul: 0.5, spdMul: 1.02, neutral: 5.5, atkRange: 4.6, crit: 0.05, ability: "mend", abilityCd: 3, abilityCost: 22 },
};
// ── Walkability nav (the painted path mask) ──────────────────────────────────
const GCOLS = _fullmask_js_1.FULL_COLS, GROWS = _fullmask_js_1.FULL_ROWS; // the FULL-arena walkmask (reaches all four corner seals)
const CELL_X = (exports.ARENA_X * 2) / GCOLS, CELL_Y = (exports.ARENA_Y * 2) / GROWS;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const quant = (v) => Math.round(v * 256) / 256;
const cellWalkable = (c, r) => c >= 0 && r >= 0 && c < GCOLS && r < GROWS && _fullmask_js_1.FULL_MASK.charCodeAt(r * GCOLS + c) === 49;
const cellCenter = (c, r) => [(c + 0.5) * CELL_X - exports.ARENA_X, (r + 0.5) * CELL_Y - exports.ARENA_Y];
const cellOf = (x, y) => [clamp(Math.floor((x + exports.ARENA_X) / CELL_X), 0, GCOLS - 1), clamp(Math.floor((y + exports.ARENA_Y) / CELL_Y), 0, GROWS - 1)];
function walkableAt(x, y) {
    if (x < -exports.ARENA_X || x > exports.ARENA_X || y < -exports.ARENA_Y || y > exports.ARENA_Y)
        return false;
    return cellWalkable(Math.floor((x + exports.ARENA_X) / CELL_X), Math.floor((y + exports.ARENA_Y) / CELL_Y));
}
function snapPoint(x, y) {
    if (walkableAt(x, y))
        return [x, y];
    const [c0, r0] = cellOf(x, y);
    for (let rad = 1; rad <= GCOLS + GROWS; rad++)
        for (let dr = -rad; dr <= rad; dr++)
            for (let dc = -rad; dc <= rad; dc++) {
                if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad)
                    continue;
                if (cellWalkable(c0 + dc, r0 + dr))
                    return cellCenter(c0 + dc, r0 + dr);
            }
    return [x, y];
}
function lineClear(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, d = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(2, Math.ceil(d / (CELL_X * 0.4))); // fine enough to catch a 1-cell-thin wall
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (!walkableAt(ax + dx * t, ay + dy * t))
            return false;
    }
    return true;
}
const BFS_DC = [1, -1, 0, 0, 1, 1, -1, -1], BFS_DR = [0, 0, 1, -1, 1, -1, 1, -1];
// Preallocated BFS scratch + a generation counter (no per-call allocation / clear).
const _N = GCOLS * GROWS;
const _came = new Int32Array(_N), _vis = new Int32Array(_N), _queue = new Int32Array(_N);
let _gen = 0;
// The fixed objective centre (the painted paw): the scroll spawn AND the seed for the
// "main" walkable region below.
const ARENA_CENTER = snapPoint(0, -1.1);
// Flood the path tiles reachable from the centre (same 8-dir + corner-cut rule the
// pathfinder uses) ONCE. The painted map leaves ~5% of its path tiles in little
// disconnected pockets near the edges; a pet that spawns/respawns into one (the old
// respawn offsets did exactly that) can never path to the fight and sits there frozen.
// Snapping every spawn / respawn / nav-goal INTO this region is what keeps pets moving.
const _mainComp = (() => {
    const set = new Uint8Array(_N);
    const [sc, sr] = cellOf(ARENA_CENTER[0], ARENA_CENTER[1]);
    if (!cellWalkable(sc, sr))
        return set;
    const q = new Int32Array(_N);
    let head = 0, tail = 0;
    const s0 = sr * GCOLS + sc;
    q[tail++] = s0;
    set[s0] = 1;
    while (head < tail) {
        const cur = q[head++];
        const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        for (let k = 0; k < 8; k++) {
            const dc = BFS_DC[k], dr = BFS_DR[k], nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr))
                continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr)))
                continue;
            const ni = nr * GCOLS + nc;
            if (set[ni])
                continue;
            set[ni] = 1;
            q[tail++] = ni;
        }
    }
    return set;
})();
const inMain = (c, r) => c >= 0 && r >= 0 && c < GCOLS && r < GROWS && _mainComp[r * GCOLS + c] === 1;
/** Snap (x,y) to the nearest path tile that is part of the centre-connected region. */
function snapMain(x, y) {
    const [c0, r0] = cellOf(x, y);
    if (walkableAt(x, y) && inMain(c0, r0))
        return [x, y];
    for (let rad = 1; rad <= GCOLS + GROWS; rad++)
        for (let dr = -rad; dr <= rad; dr++)
            for (let dc = -rad; dc <= rad; dc++) {
                if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad)
                    continue;
                if (inMain(c0 + dc, r0 + dr))
                    return cellCenter(c0 + dc, r0 + dr);
            }
    return snapPoint(x, y);
}
// Full-path BFS (reverse flood from the goal) reconstructed pet→goal as cell indices.
// A full path + line-of-sight string-pulling (below) gives smooth, direct motion that
// hugs corners — instead of the old jerky one-cell-every-4-ticks re-step that stalled
// on every turn.
function bfsPath(fc, fr, tc, tr, out) {
    out.length = 0;
    if (fc === tc && fr === tr)
        return out;
    _gen++;
    const start = tr * GCOLS + tc;
    _vis[start] = _gen;
    _came[start] = -1;
    let head = 0, tail = 0;
    _queue[tail++] = start;
    let hit = -1;
    while (head < tail) {
        const cur = _queue[head++];
        const cc = cur % GCOLS, cr = (cur - cc) / GCOLS;
        if (cc === fc && cr === fr) {
            hit = cur;
            break;
        }
        for (let k = 0; k < 8; k++) {
            const dc = BFS_DC[k], dr = BFS_DR[k], nc = cc + dc, nr = cr + dr;
            if (!cellWalkable(nc, nr))
                continue;
            if (dc !== 0 && dr !== 0 && (!cellWalkable(cc + dc, cr) || !cellWalkable(cc, cr + dr)))
                continue;
            const ni = nr * GCOLS + nc;
            if (_vis[ni] === _gen)
                continue;
            _vis[ni] = _gen;
            _came[ni] = cur;
            _queue[tail++] = ni;
        }
    }
    if (hit < 0)
        return out; // unreachable — caller falls back to a straight nudge
    for (let cur = hit; cur >= 0; cur = _came[cur])
        out.push(cur); // pet → … → goal
    return out;
}
const cellPt = (idx) => cellCenter(idx % GCOLS, (idx - (idx % GCOLS)) / GCOLS);
/** Advance `f` one step toward (tx,ty), facing (faceGx,faceGy). Returns whether it
 *  intended to move (so the caller's stuck-watchdog can tell "blocked" from "arrived"). */
function stepStraight(f, tx, ty, spd, stopAt, faceGx, faceGy) {
    const fdx = faceGx - f.x, fdy = faceGy - f.y, fl = Math.sqrt(fdx * fdx + fdy * fdy);
    if (fl > 1e-6) {
        f.faceX = fdx / fl;
        f.faceY = fdy / fl;
    }
    const dx = tx - f.x, dy = ty - f.y, d = Math.sqrt(dx * dx + dy * dy);
    const s = Math.min(spd, Math.max(0, d - stopAt));
    if (s <= 0 || d <= 1e-6)
        return false;
    const ux = dx / d, uy = dy / d, nx = f.x + ux * s, ny = f.y + uy * s;
    // Verify the STEP doesn't cross a wall (not just that the endpoint is walkable) —
    // else a fast step / a corner-cut could hop over a thin wall. Slide along an axis.
    if (walkableAt(nx, ny) && lineClear(f.x, f.y, nx, ny)) {
        f.x = nx;
        f.y = ny;
    }
    else if (walkableAt(nx, f.y) && lineClear(f.x, f.y, nx, f.y))
        f.x = nx;
    else if (walkableAt(f.x, ny) && lineClear(f.x, f.y, f.x, ny))
        f.y = ny;
    return true;
}
/** Last-resort un-wedge: hop one cell along the walkable compass dir that best closes on
 *  the goal — but ALWAYS take a walkable step if any exists (least-bad when escape means
 *  briefly stepping away from a concave nook), so a wedged pet can never stay frozen.
 *  Deterministic; only fires after the watchdog sees a real jam. */
function unstick(f, gx, gy, spd) {
    const cur = Math.sqrt((gx - f.x) * (gx - f.x) + (gy - f.y) * (gy - f.y));
    const step = Math.max(spd, CELL_Y);
    let best = -1, bestGain = -Infinity;
    for (let k = 0; k < 8; k++) {
        const nx = f.x + BFS_DC[k] * step, ny = f.y + BFS_DR[k] * step;
        if (!walkableAt(nx, ny))
            continue;
        const dx = gx - nx, dy = gy - ny, gain = cur - Math.sqrt(dx * dx + dy * dy);
        if (gain > bestGain) {
            bestGain = gain;
            best = k;
        }
    }
    if (best >= 0) {
        f.x += BFS_DC[best] * step;
        f.y += BFS_DR[best] * step;
    }
}
/** Steer `f` toward (gx,gy): straight when the goal is visible, else follow a string-
 *  pulled BFS path around terrain. Repaths from the CURRENT cell on a short cadence so a
 *  moving goal stays tracked, and self-recovers if it ever wedges — so nothing freezes. */
function moveToward(f, gx, gy, spd, stopAt = 0) {
    // Keep the pet ON the navigable mesh: if quantize/body-shove ever nudges it onto a
    // non-path tile (or off the centre-connected region), pull it back — otherwise it
    // can't be pathed and would sit wedged.
    {
        const [fc0, fr0] = cellOf(f.x, f.y);
        if (!inMain(fc0, fr0)) {
            const [mx, my] = snapMain(f.x, f.y);
            f.x = mx;
            f.y = my;
            f.path = null;
            f.navAge = 0;
        }
    }
    const sx = f.x, sy = f.y;
    let attempted;
    if (lineClear(f.x, f.y, gx, gy)) { // clear shot — go straight, drop any path
        f.path = null;
        f.navAge = 0;
        attempted = stepStraight(f, gx, gy, spd, stopAt, gx, gy);
    }
    else {
        // Route to the goal's cell, snapped into the reachable region if it's blocked.
        let [tc, tr] = cellOf(gx, gy);
        if (!inMain(tc, tr)) {
            const [mx, my] = snapMain(gx, gy);
            [tc, tr] = cellOf(mx, my);
        }
        const goalCell = tr * GCOLS + tc;
        const [fc, fr] = cellOf(f.x, f.y);
        if (!f.path || f.navAge <= 0 || f.navGoal !== goalCell) {
            f.path = f.path ?? [];
            bfsPath(fc, fr, tc, tr, f.path);
            f.navGoal = goalCell;
            f.navAge = 8;
            f.pathIdx = 1;
        }
        f.navAge--;
        const path = f.path;
        if (!path || path.length <= 1) { // no route — straight nudge (watchdog may kick in)
            attempted = stepStraight(f, gx, gy, spd, stopAt, gx, gy);
        }
        else {
            let idx = f.pathIdx < 1 ? 1 : (f.pathIdx > path.length - 1 ? path.length - 1 : f.pathIdx);
            while (idx < path.length - 1) { // string-pull: skip to the farthest visible node
                const [wx, wy] = cellPt(path[idx + 1]);
                if (lineClear(f.x, f.y, wx, wy))
                    idx++;
                else
                    break;
            }
            f.pathIdx = idx;
            if (idx >= path.length - 1 && lineClear(f.x, f.y, gx, gy)) { // last node + goal in view → finish straight
                attempted = stepStraight(f, gx, gy, spd, stopAt, gx, gy);
            }
            else {
                const [wx, wy] = cellPt(path[idx]);
                attempted = stepStraight(f, wx, wy, spd, idx >= path.length - 1 ? stopAt : 0, gx, gy);
            }
        }
    }
    // Stuck watchdog: meant to move but didn't → repath fast, then hop free. Keeps a pet
    // from ever locking up in a concave nook or behind a body it can't slide past.
    if (attempted && Math.abs(f.x - sx) + Math.abs(f.y - sy) < 0.004) {
        f.stuckTicks++;
        if (f.stuckTicks === 3) {
            f.path = null;
            f.navAge = 0;
        } // first: force a fresh route
        else if (f.stuckTicks >= 6) {
            unstick(f, gx, gy, spd);
            f.stuckTicks = 0;
            f.path = null;
            f.navAge = 0;
        } // then: physically hop free
    }
    else
        f.stuckTicks = 0;
}
const dist = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
const distPt = (a, x, y) => { const dx = a.x - x, dy = a.y - y; return Math.sqrt(dx * dx + dy * dy); };
// ── Deterministic RNG ────────────────────────────────────────────────────────
function makeRng(seed) {
    let s = (Math.max(1, Math.floor(seed)) >>> 0) || 1;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
// The two spawn seals per team (arena corners), snapped to a path tile. 2v2 puts
// one pet on each seal; 4v4 puts two pets (a "player" pair) on each seal.
// Field positions of the four painted spawn seals, measured off the diorama art
// (scripts/find-seals.mjs); snapped to the nearest walkable path tile so pets
// emerge ON the seal. [0] = upper seal, [1] = lower seal, per team. Left on the
// real (slightly asymmetric) art on purpose: symmetric-team balance is moot —
// pets are trained differently, so quality decides and a stronger team wins from
// either side (verified) — so seal-art alignment wins over a mirror-perfect spawn.
const SEALS = {
    blue: [snapPoint(-10.3, -5.6), snapPoint(-12.4, 2.5)],
    red: [snapPoint(9.5, -5.0), snapPoint(11.7, 2.5)],
};
function buildFighter(pet, team, role, slot, count, applyItems = false) {
    const cfg = ROLE_CFG[role];
    // PvP-ladder items: fold the equipped PVP gear's passive stat mods into the pet
    // BEFORE the role multipliers (deterministic), then seed its gear start-shield and
    // reactive consumable charges. applyItems off → byte-identical to before.
    const gp = applyItems ? (0, _pet_gear_js_1.applyPetPvpGear)(pet) : pet;
    const seals = SEALS[team];
    const sealIdx = count <= 2 ? Math.min(slot, 1) : (slot < 2 ? 0 : 1);
    const [sx, sy] = seals[sealIdx];
    const [x, y] = snapMain(sx, sy + (count <= 2 ? 0 : slot % 2 ? 0.9 : -0.9));
    const maxHp = Math.max(1, Math.round((gp.hp || 600) * cfg.hpMul * TTK_HP_MUL));
    const ch = applyItems ? (0, _pet_gear_js_1.petConsumableCharges)(gp) : null;
    return {
        id: `${team}-${slot}`, team, slot, role, pet: gp, element: gp.element,
        x, y, faceX: team === "blue" ? 1 : -1, faceY: 0, baseX: sx, baseY: sy, seals,
        hp: maxHp, maxHp, atk: Math.max(1, (gp.attack || 60) * cfg.dmgMul), def: Math.max(0, (gp.defense || 30) * cfg.defMul),
        moveSpeed: clamp(2.6 + (gp.speed || 50) * 0.016, 2.6, 6.0) * cfg.spdMul / exports.ARENA_TPS,
        // Movement saturates at the clamp above, but Speed keeps paying off as crit
        // chance (role base + ownSpeed/divisor, capped) — KEEP IN SYNC with the client
        // pet-arena-sim.ts. Uses gear-scaled speed (gp) so +SPD PvP gear also lifts crit.
        atkRange: cfg.atkRange, crit: Math.min(0.5, cfg.crit + (gp.speed || 50) / SPEED_CRIT_DIVISOR), energy: 100, lives: 3,
        state: "idle", respawnLeft: 0, attackCd: 0, abilityCd: Math.round(exports.ARENA_TPS * 1.5), dashLeft: 0, moveDx: 0, moveDy: 0,
        shieldHp: applyItems ? (0, _pet_gear_js_1.petGearStartShield)(gp) : 0, slowLeft: 0, dotLeft: 0, dotDmg: 0, markLeft: 0, tauntBy: null, tauntLeft: 0, carrying: false,
        path: null, pathIdx: 0, navGoal: -1, navAge: 0, stuckTicks: 0, aiTargetId: null, plan: null, decisionCd: 0,
        itemsOn: applyItems,
        cDodge: ch ? ch.dodge : 0, cMitigatePct: ch ? ch.mitigate : 0, cEndure: ch ? ch.endure : 0,
        cThornsPct: ch ? ch.thorns : 0, cLifelinePct: ch ? ch.lifeline : 0, cCleanse: ch ? ch.cleanse : 0,
    };
}
const alive = (f) => f.lives > 0 && f.state !== "dead" && f.state !== "respawning";
const effSpeed = (f) => f.moveSpeed * (f.slowLeft > 0 ? 0.6 : 1) * (f.carrying ? CARRIER_SLOW : 1);
// ── Combat ───────────────────────────────────────────────────────────────────
function dealDamage(src, tgt, raw, rng, t, events, ability = false) {
    const crit = rng() < src.crit;
    // DODGE consumable fully negates the incoming hit (no damage, no procs).
    if (tgt.itemsOn && tgt.cDodge > 0) {
        tgt.cDodge -= 1;
        return;
    }
    let mult = (crit ? 1.8 : 1) * (tgt.markLeft > 0 ? 1.25 : 1);
    if (src.itemsOn)
        mult *= (0, _pet_gear_js_1.petGearExecuteMult)(src.pet, tgt.hp, tgt.maxHp); // gear execute vs low-HP foe
    let dmg = Math.max(1, Math.round((raw - tgt.def * 0.38) * mult));
    if (tgt.itemsOn) {
        dmg = Math.max(1, Math.round(dmg * (0, _pet_gear_js_1.petGearLastStandMult)(tgt.pet, tgt.hp, tgt.maxHp))); // gear last-stand while low
        if (tgt.cMitigatePct > 0) {
            dmg = Math.max(1, Math.round(dmg * (1 - tgt.cMitigatePct / 100)));
            tgt.cMitigatePct = 0;
        } // smoke-pellet
    }
    if (tgt.shieldHp > 0) {
        const absorbed = Math.min(tgt.shieldHp, dmg);
        tgt.shieldHp -= absorbed;
        dmg -= absorbed;
    }
    if (tgt.itemsOn && tgt.cEndure > 0 && dmg >= tgt.hp && tgt.hp > 1) {
        dmg = tgt.hp - 1;
        tgt.cEndure -= 1;
    } // survive one lethal blow
    tgt.hp -= dmg;
    events.push({ t, type: "hit", targetId: tgt.id, actorId: src.id, dmg, crit, element: src.element, ability });
    if (dmg > 0) {
        // THORNS consumable: reflect a % of the damage back at the attacker (once).
        if (tgt.itemsOn && tgt.cThornsPct > 0 && src.hp > 0) {
            const reflect = Math.max(1, Math.round(dmg * tgt.cThornsPct / 100));
            src.hp -= reflect;
            tgt.cThornsPct = 0;
            events.push({ t, type: "hit", targetId: src.id, actorId: tgt.id, dmg: reflect, crit: false, element: tgt.element, ability: false });
        }
        // Attacker gear procs on a BASIC hit (ability === false): poison DoT + lifesteal.
        if (src.itemsOn && !ability) {
            const dot = (0, _pet_gear_js_1.petGearDotOnHit)(src.pet);
            if (dot) {
                tgt.dotLeft = Math.max(tgt.dotLeft, Math.round(exports.ARENA_TPS * 0.5 * dot.rounds));
                tgt.dotDmg = Math.max(tgt.dotDmg, dot.damage);
            }
            const heal = (0, _pet_gear_js_1.petGearLifestealHeal)(src.pet, dmg);
            if (heal > 0)
                src.hp = Math.min(src.maxHp, src.hp + heal);
        }
        // LIFELINE consumable: the first drop below the threshold heals % of max HP.
        if (tgt.itemsOn && tgt.cLifelinePct > 0 && tgt.hp > 0 && (tgt.hp / tgt.maxHp) * 100 < _pet_gear_js_1.PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT) {
            const heal = Math.max(1, Math.round(tgt.maxHp * tgt.cLifelinePct / 100));
            tgt.hp = Math.min(tgt.maxHp, tgt.hp + heal);
            tgt.cLifelinePct = 0;
            events.push({ t, type: "heal", targetId: tgt.id, actorId: tgt.id, amount: heal });
        }
    }
}
// ── AI: pick a goal + target by role × objective context ─────────────────────
function nearestEnemy(f, fs) {
    let best = null, bd = Infinity;
    for (const g of fs) {
        if (g.team === f.team || !alive(g))
            continue;
        const d = dist(f, g);
        if (d < bd) {
            bd = d;
            best = g;
        }
    }
    return best;
}
function lowestHpAlly(f, fs, includeSelf = true) {
    let best = null, bf = Infinity;
    for (const g of fs) {
        if (g.team !== f.team || !alive(g) || (!includeSelf && g.id === f.id))
            continue;
        const r = g.hp / g.maxHp;
        if (r < bf) {
            bf = r;
            best = g;
        }
    }
    return best;
}
function nearestSeal(f) {
    let best = f.seals[0], bd = distPt(f, best[0], best[1]);
    for (const s of f.seals) {
        const d = distPt(f, s[0], s[1]);
        if (d < bd) {
            bd = d;
            best = s;
        }
    }
    return best;
}
// ── Score-based tactical AI ───────────────────────────────────────────────────
// Each pet scores a small set of role-appropriate INTENTS (objective + threat +
// role + survival + team-tactics) and commits to the highest, so a viewer reads
// each pet's job without any UI: Defender protects, Tracker hunts, Assassin
// eliminates priority targets, Sage supports. The role priority NUMBERS come
// straight from the combat handoff. Fully deterministic — positions/hp/roles
// only, no rng in here; ties resolve to the first (fixed-order) candidate.
const THREAT = { defender: 30, tracker: 60, assassin: 90, sage: 100 };
const hpFrac = (f) => f.hp / f.maxHp;
const oppOf = (t) => (t === "blue" ? "red" : "blue");
const teamLives = (fs, team) => fs.reduce((s, g) => (g.team === team ? s + Math.max(0, g.lives) : s), 0);
const enemiesAlive = (f, fs) => fs.filter((g) => g.team !== f.team && alive(g));
const alliesAlive = (f, fs, includeSelf = true) => fs.filter((g) => g.team === f.team && alive(g) && (includeSelf || g.id !== f.id));
function nearestPt(x, y, list) { let b = null, bd = Infinity; for (const g of list) {
    const dx = g.x - x, dy = g.y - y, dd = dx * dx + dy * dy;
    if (dd < bd) {
        bd = dd;
        b = g;
    }
} return b; }
function countWithin(x, y, list, r) { let n = 0; const r2 = r * r; for (const g of list) {
    const dx = g.x - x, dy = g.y - y;
    if (dx * dx + dy * dy <= r2)
        n++;
} return n; }
/** The enemy assassin closest to me or any ally, when within striking range. */
function assassinThreat(f, fs) {
    const guard = alliesAlive(f, fs, true);
    let best = null, bd = Infinity;
    for (const e of enemiesAlive(f, fs)) {
        if (e.role !== "assassin")
            continue;
        for (const a of guard) {
            const d = dist(a, e);
            if (d < bd) {
                bd = d;
                best = e;
            }
        }
    }
    return best && bd < 5.5 ? best : null;
}
/** Highest-THREAT enemy, lightly distance-discounted (Tracker's default pick). */
function threatTarget(f, enemies) { let b = null, bv = -Infinity; for (const e of enemies) {
    const v = THREAT[e.role] - dist(f, e) * 1.2;
    if (v > bv) {
        bv = v;
        b = e;
    }
} return b; }
function makeCtx(f, fs, scroll, score) {
    const carrier = scroll.carrierId ? fs.find((g) => g.id === scroll.carrierId) ?? null : null;
    const mine = score[f.team], opp = score[oppOf(f.team)], lead = mine - opp;
    const phase = (mine >= exports.WIN_SCORE - 1 || opp >= exports.WIN_SCORE - 1) ? "emergency" : lead >= 3 ? "closeit" : lead <= -3 ? "comeback" : "normal";
    return {
        myCarrier: carrier && carrier.team === f.team ? carrier : null,
        enemyCarrier: carrier && carrier.team !== f.team ? carrier : null,
        scrollOpen: scroll.state === "center" || scroll.state === "dropped",
        scrollSoon: scroll.state === "inactive" && scroll.spawnTimer <= exports.ARENA_TPS * SCROLL_ANTICIPATE, // about to spawn → pre-position
        leadLives: teamLives(fs, f.team) - teamLives(fs, oppOf(f.team)),
        leadScore: lead, phase,
    };
}
// ── Squad awareness (built ONCE per tick, shared by every pet) ─────────────────
// Role "power" for outnumbered checks + the focus-fire tally (how many of a team's
// pets are committed to each enemy) so allies naturally collapse on the same kill.
const POWER = { defender: 110, tracker: 100, assassin: 90, sage: 80 };
// ── Team blackboard (R1) ───────────────────────────────────────────────────────
// Built ONCE per tick on the frozen start-of-tick board (deterministic: positions /
// hp / roles only, ties broken by id; no rng) — turns four independent agents into a
// SQUAD by publishing three shared decisions every pet reads when it scores intents:
//   • focus      — last-tick target tally (the old emergent collapse; kept so a pet
//                  still piles onto whoever its allies already chose)
//   • callTarget — the ONE enemy this team should collapse on THIS tick (carrier >
//                  nearly-dead > high-value role), so the offence converges in a single
//                  decision cycle instead of dribbling a kill out over several
//   • peel       — defenderId → the enemy diver/carrier it is assigned to body-block,
//                  so two defenders never peel the same threat and none goes unpeeled
// (A team-wide "fall back when out-powered" cascade was prototyped here too, but it
//  turned near-even matches into turtle stalemates — draws nearly doubled — so it was
//  cut; the local-outnumber regroup in candidates() already covers piecemeal feeding.)
const CALL_TARGET_BONUS = 20; // directed focus-fire weight (modest: nudges target choice, never overrides the objective)
const PRESS_THRESH = 1.1, REGROUP_THRESH = -2.2; // asymmetric: regroup needs a CLEAR board deficit (not a mild one) so a team presses through small disadvantages instead of turtling to the cap (captures are the only score)
/** Board "standing" for `team`: role/HP-weighted power delta + life-reserve delta +
 *  who holds the scroll. >0 = winning the board, <0 = losing it. Deterministic. */
function teamStanding(fs, team, scroll) {
    const opp = oppOf(team);
    let myPow = 0, enPow = 0;
    for (const g of fs) {
        if (!alive(g))
            continue;
        const p = POWER[g.role] * hpFrac(g);
        if (g.team === team)
            myPow += p;
        else
            enPow += p;
    }
    const powTerm = (myPow - enPow) / Math.max(1, myPow + enPow); // −1..1
    const myL = teamLives(fs, team), enL = teamLives(fs, opp);
    const lifeTerm = (myL - enL) / Math.max(1, myL + enL); // −1..1
    let carrierEdge = 0;
    if (scroll.state === "carried" && scroll.carrierId) {
        const c = fs.find((g) => g.id === scroll.carrierId);
        if (c)
            carrierEdge = c.team === team ? 1 : -1;
    }
    return powTerm * 3 + lifeTerm * 1.5 + carrierEdge * 0.6;
}
/** Composition lean: a burst/skirmish team (≥2 assassins, or an assassin+tracker pair)
 *  wants to PRESS to cash in its burst — so it crosses into "press" on a smaller edge. */
function compBias(fs, team) {
    let asn = 0, trk = 0;
    for (const g of fs)
        if (g.team === team) {
            if (g.role === "assassin")
                asn++;
            else if (g.role === "tracker")
                trk++;
        }
    return (asn >= 2 ? 0.6 : 0) + (asn >= 1 && trk >= 1 ? 0.2 : 0);
}
function teamPosture(fs, team, scroll) {
    const s = teamStanding(fs, team, scroll) + compBias(fs, team);
    return s >= PRESS_THRESH ? "press" : s <= REGROUP_THRESH ? "regroup" : "even";
}
/** The team's rally point for re-forming: the safest of {each ally, the ally centroid}
 *  by LOCAL power balance (an influence read), then pulled toward the objective so a
 *  rally always stages FORWARD, never a home-corner turtle. Snapped onto the connected
 *  mesh. Deterministic (stable scan order, first-wins ties). */
function teamRally(fs, team) {
    const allies = fs.filter((g) => g.team === team && alive(g));
    if (allies.length === 0)
        return ARENA_CENTER;
    const enemies = fs.filter((g) => g.team !== team && alive(g));
    let cx = 0, cy = 0;
    for (const a of allies) {
        cx += a.x;
        cy += a.y;
    }
    cx /= allies.length;
    cy /= allies.length;
    const cands = allies.map((a) => [a.x, a.y]);
    cands.push([cx, cy]);
    let best = cands[0], bv = -Infinity;
    for (const [x, y] of cands) {
        const dcx = x - ARENA_CENTER[0], dcy = y - ARENA_CENTER[1];
        const v = localPower(x, y, allies, 5.5) - localPower(x, y, enemies, 5.5) - Math.sqrt(dcx * dcx + dcy * dcy) * 4;
        if (v > bv) {
            bv = v;
            best = [x, y];
        } // first-wins ties (stable order) → deterministic
    }
    return snapMain((best[0] + ARENA_CENTER[0]) / 2, (best[1] + ARENA_CENTER[1]) / 2);
}
function buildSquad(fs, scroll) {
    const focus = { blue: {}, red: {} };
    for (const g of fs) {
        if (!alive(g) || !g.aiTargetId)
            continue;
        const m = focus[g.team];
        m[g.aiTargetId] = (m[g.aiTargetId] ?? 0) + 1;
    }
    return {
        focus,
        callTarget: { blue: pickCallTarget(fs, "blue"), red: pickCallTarget(fs, "red") },
        peel: assignPeels(fs),
        posture: { blue: teamPosture(fs, "blue", scroll), red: teamPosture(fs, "red", scroll) },
        rally: { blue: teamRally(fs, "blue"), red: teamRally(fs, "red") },
    };
}
/** The enemy `team` should collapse on this tick: the carrier, then whoever is closest
 *  to death (execute), then the highest-value role — discounted by how far the team must
 *  travel to reach it. Deterministic (id tiebreak). */
function pickCallTarget(fs, team) {
    const allies = fs.filter((g) => g.team === team && alive(g));
    if (allies.length === 0)
        return null;
    let best = null, bv = -Infinity;
    for (const e of fs) {
        if (e.team === team || !alive(e))
            continue;
        let ds = 0;
        for (const a of allies)
            ds += dist(a, e);
        const v = THREAT[e.role] + (e.carrying ? 80 : 0) + (1 - hpFrac(e)) * 140 + (e.markLeft > 0 ? 20 : 0) - (ds / allies.length) * 2;
        if (v > bv || (v === bv && best !== null && e.id < best.id)) {
            bv = v;
            best = e;
        }
    }
    return best ? best.id : null;
}
/** Assign each defender the most dangerous enemy to body-block — carrier hardest, then a
 *  diving assassin, then a close tracker. Greedy + nearest-defender-wins + no double-
 *  assignment, so threats are covered once each. Then a cross-role fallback (R2): a carrier
 *  no defender claimed is given the nearest available non-defender, so a defenderless team
 *  still contests the carry. Deterministic (id-sorted throughout). */
function assignPeels(fs) {
    const out = {};
    for (const team of ["blue", "red"]) {
        const allies = fs.filter((g) => g.team === team && alive(g));
        if (allies.length === 0)
            continue;
        const defenders = allies.filter((g) => g.role === "defender").sort((a, b) => (a.id < b.id ? -1 : 1));
        const threats = [];
        for (const e of fs) {
            if (e.team === team || !alive(e))
                continue;
            let near = Infinity;
            for (const a of allies) {
                const d = dist(a, e);
                if (d < near)
                    near = d;
            }
            let danger = -Infinity;
            if (e.carrying)
                danger = 1000 - near;
            else if (e.role === "assassin" && near < 6)
                danger = 500 - near;
            else if (e.role === "tracker" && near < 4)
                danger = 200 - near;
            if (danger > -Infinity)
                threats.push({ e, danger });
        }
        threats.sort((a, b) => b.danger - a.danger || (a.e.id < b.e.id ? -1 : 1));
        const taken = new Set();
        for (const def of defenders) {
            let pick = null, pv = -Infinity;
            for (const th of threats) {
                if (taken.has(th.e.id))
                    continue;
                const v = th.danger - dist(def, th.e) * 3;
                if (v > pv || (v === pv && pick !== null && th.e.id < pick.id)) {
                    pv = v;
                    pick = th.e;
                }
            }
            if (pick) {
                out[def.id] = pick.id;
                taken.add(pick.id);
            }
        }
        // Cross-role carry coverage: a carrier no defender claimed (a defenderless team, or
        // every defender already on another threat) goes to the nearest available non-
        // defender — assassin first, then tracker, then sage. Deterministic: role, dist, id.
        const carrier = fs.find((e) => e.team !== team && alive(e) && e.carrying) ?? null;
        if (carrier && !taken.has(carrier.id)) {
            const pref = { assassin: 0, tracker: 1, sage: 2, defender: 3 };
            let pick = null;
            for (const a of allies) {
                if (a.role === "defender" || a.carrying || out[a.id])
                    continue;
                if (pick === null) {
                    pick = a;
                    continue;
                }
                const da = dist(a, carrier), dp = dist(pick, carrier);
                if (pref[a.role] < pref[pick.role] || (pref[a.role] === pref[pick.role] && (da < dp || (da === dp && a.id < pick.id))))
                    pick = a;
            }
            if (pick)
                out[pick.id] = carrier.id;
        }
    }
    return out;
}
/** Role-weighted, HP-scaled fighting power of `list` within radius r of a point. */
function localPower(x, y, list, r) {
    let p = 0;
    const r2 = r * r;
    for (const g of list) {
        const dx = g.x - x, dy = g.y - y;
        if (dx * dx + dy * dy <= r2)
            p += POWER[g.role] * hpFrac(g);
    }
    return p;
}
/** A teammate (not me) below 30% HP with an enemy bearing down on it → rescue. */
function criticalAlly(f, fs) {
    const enemies = enemiesAlive(f, fs);
    let best = null, bd = Infinity;
    for (const a of alliesAlive(f, fs, false)) {
        if (hpFrac(a) >= 0.30)
            continue;
        const ne = nearestPt(a.x, a.y, enemies);
        if (ne && dist(a, ne) < 4.5) {
            const d = dist(f, a);
            if (d < bd) {
                bd = d;
                best = a;
            }
        }
    }
    return best;
}
const huntP = (f, e, neutral) => ({ ...spreadGoal(f, e, neutral), target: e, channel: false });
const diveP = (e, stop) => ({ gx: e.x, gy: e.y, stopAt: stop, target: e, channel: false });
const pokeP = (e, neutral) => ({ gx: e.x, gy: e.y, stopAt: neutral, target: e, channel: false });
// Sit on the HOME side of an ally (sage never leads the engagement).
const behindP = (f, ally, target) => ({ gx: ally.x + (f.team === "blue" ? -2.6 : 2.6), gy: ally.y, stopAt: 0.4, target, channel: false });
function retreatP(f, fs) {
    const anchor = nearestPt(f.x, f.y, alliesAlive(f, fs, false));
    const [bx, by] = nearestSeal(f);
    const gx = anchor ? (anchor.x + bx) / 2 : bx, gy = anchor ? (anchor.y + by) / 2 : by;
    const block = nearestEnemy(f, fs);
    return { gx, gy, stopAt: 0, target: block && dist(f, block) < f.atkRange ? block : null, channel: false }; // only fight if cornered
}
function contestP(f, fs, scroll) {
    const dScroll = distPt(f, scroll.x, scroll.y);
    const channeler = scroll.channelById ? fs.find((g) => g.id === scroll.channelById) ?? null : null;
    // No one's on the pickup + I'm in range → I channel it.
    if (dScroll <= PICKUP_RANGE && (channeler === null || channeler.id === f.id))
        return { gx: f.x, gy: f.y, stopAt: 0, target: nearestEnemy(f, fs), channel: true };
    // Someone ELSE is channelling — do NOT freeze: rush an ENEMY channeller to break
    // it (killing/reaching it cancels the pickup), or guard an ALLY channeller (ring
    // up around the spot and fight whoever comes).
    if (channeler && channeler.id !== f.id) {
        if (channeler.team !== f.team)
            return { gx: channeler.x, gy: channeler.y, stopAt: 0.2, target: channeler, channel: false };
        const goff = f.role === "assassin" ? 2.2 : f.role === "sage" ? 3.0 : 1.3;
        return { gx: scroll.x + (f.team === "blue" ? -goff : goff), gy: scroll.y + (f.slot % 2 ? goff : -goff), stopAt: 0.4, target: nearestEnemy(f, fs), channel: false };
    }
    // Free scroll — approach with the role offset (assassin flanks, sage holds back).
    const off = f.role === "assassin" ? 2.2 : f.role === "sage" ? 3.0 : 0;
    const ex = scroll.x + (f.team === "blue" ? -off : off), ey = scroll.y + (f.slot % 2 ? off : -off);
    return { gx: off ? ex : scroll.x, gy: off ? ey : scroll.y, stopAt: off ? 0.5 : 0, target: nearestEnemy(f, fs), channel: false };
}
/** Pre-position for the IMMINENT scroll spawn (scroll.x/y holds the spawn point):
 *  defender claims the spot, tracker pressures it, assassin takes a flank, sage rings
 *  up behind — so the spawn is a beat the squad has gathered for, not a surprise. */
function anticipateP(f, fs, scroll) {
    const off = f.role === "assassin" ? 2.8 : f.role === "sage" ? 3.4 : f.role === "tracker" ? 1.6 : 0.7;
    const ex = scroll.x + (f.team === "blue" ? -off : off), ey = scroll.y + (f.slot % 2 ? off : -off);
    return { gx: ex, gy: ey, stopAt: 0.4, target: nearestEnemy(f, fs), channel: false };
}
/** Rally to the commander's influence-picked point (teamRally): the safest cluster of
 *  the squad pulled toward the objective, so a regrouping pet re-forms FORWARD with its
 *  team instead of parking in its spawn corner (which reads as — and tests as — frozen).
 *  moveToward snaps the goal into the connected region. Only used when there IS an ally
 *  to group to (see candidates). */
function regroupPlan(f, fs, rally) {
    const [gx, gy] = rally; // the commander's influence-picked rally (forward of home, near the objective)
    const block = nearestEnemy(f, fs);
    return { gx, gy, stopAt: 1.2, target: block && dist(f, block) < f.atkRange ? block : null, channel: false };
}
/** Rescue a critical ally — role-specific: sage heal-positions on it, defender bodies
 *  between it and the threat, tracker/assassin punish the attacker. */
function protectPlan(f, ally, fs) {
    const threat = nearestPt(ally.x, ally.y, enemiesAlive(f, fs));
    if (f.role === "sage")
        return { plan: behindP(f, ally, null), score: 94 };
    if (f.role === "defender" && threat)
        return { plan: { gx: (ally.x + threat.x) / 2, gy: (ally.y + threat.y) / 2, stopAt: 0, target: threat, channel: false }, score: 86 };
    if (threat)
        return { plan: huntP(f, threat, ROLE_CFG[f.role].neutral), score: f.role === "tracker" ? 72 : 62 };
    return { plan: behindP(f, ally, nearestEnemy(f, fs)), score: 42 };
}
const SAME_TARGET_BONUS = 13; // per OTHER ally already committed to a target → collapse on it
const OUTNUMBER_RATIO = 1.5, LOCAL_R = 6;
const REGROUP_SCORE = { sage: 88, assassin: 85, tracker: 58, defender: 35 }; // sage/assassin disengage first, defender last
// Per-role peel commitment (R2): how hard each role answers a threat the blackboard
// ASSIGNED it to body-block. Defender carrier/diver = the R1-validated 62/56. A
// non-defender only ever gets a CARRIER assignment — the cross-role fallback when a
// team has no free defender — and weighs it ABOVE its own hunt of that carrier, so the
// one designated peeler dives to body-block while the rest keep poking (one denier, not
// a stall-inducing pile-on). Sage is last resort: pokes from safety, never dives.
const PEEL_SCORE = {
    defender: { carrier: 62, diver: 56 },
    assassin: { carrier: 98, diver: 36 }, // > assassin hunt(carrier)=95 → the assigned one dives the carry
    tracker: { carrier: 84, diver: 44 }, // > tracker hunt(carrier)=80 → the assigned one chases in close
    sage: { carrier: 34, diver: 20 },
};
/** Build the role's scored candidate intents (handoff priority numbers) layered with
 *  squad awareness: focus-fire, rescue, and regroup-when-outnumbered. */
function candidates(f, fs, scroll, ctx, squad) {
    const cfg = ROLE_CFG[f.role];
    const enemies = enemiesAlive(f, fs);
    const cands = [];
    const stick = (e) => (e.id === f.aiTargetId ? 6 : 0); // hysteresis — resist flip-flopping
    const distPen = (e) => clamp(dist(f, e), 0, 16) * 1.1; // prefer reachable high-value targets
    // Focus-fire: bonus for piling onto an enemy MY OTHER allies already target.
    const fire = (e) => SAME_TARGET_BONUS * Math.max(0, (squad.focus[f.team][e.id] ?? 0) - (f.aiTargetId === e.id ? 1 : 0));
    // Directed focus-fire: the blackboard's called kill — collapse the OFFENCE on it
    // this cycle (carrier / nearly-dead / high-value), instead of waiting for `fire`
    // to accumulate over several ticks. Gated to open fighting: while the scroll is live
    // or imminent the OBJECTIVE owns priority, else the pull drags a winnable scroll race
    // off the point and matches stall to the time cap (captures are the only score).
    const call = squad.callTarget[f.team];
    const directing = call !== null && !ctx.scrollOpen && !ctx.scrollSoon;
    const callBonus = (e) => (directing && e.id === call ? CALL_TARGET_BONUS : 0);
    const huntC = (e, base) => ({ score: base - distPen(e) + stick(e) + fire(e) + callBonus(e), kind: "hunt", plan: huntP(f, e, cfg.neutral) });
    // SQUAD LAYER (all roles): rescue a dying ally, regroup when locally outnumbered.
    const crit = criticalAlly(f, fs);
    if (crit) {
        const p = protectPlan(f, crit, fs);
        cands.push({ score: p.score, kind: "protectAlly", plan: p.plan });
    }
    if (!f.carrying && alliesAlive(f, fs, false).length > 0) { // "regroup" needs an ally to group TO — a lone pet fights (stays mobile)
        const myPow = localPower(f.x, f.y, alliesAlive(f, fs, true), LOCAL_R);
        const enPow = localPower(f.x, f.y, enemies, LOCAL_R);
        // Regroup is the SELF-LIMITING local-outnumber pull-back: it only exists while a
        // pet is genuinely being collapsed on (enPow > myPow×1.5 nearby), and vanishes the
        // moment allies group up — so the team re-forms and RE-ENGAGES instead of turtling.
        // The commander only ever AMPLIFIES this (POSTURE_ADJ.regroup) for a board-losing
        // team and points it at the influence-picked rally — never forces a team-wide
        // fallback (a prototype that did exactly that dragged near-even matches to the cap).
        if (enPow > myPow * OUTNUMBER_RATIO)
            cands.push({ score: REGROUP_SCORE[f.role], kind: "regroup", plan: regroupPlan(f, fs, squad.rally[f.team]) });
    }
    // PEEL (R2, cross-role): answer the threat the blackboard ASSIGNED to me. Defenders
    // are assigned first; if a team has no free defender the nearest non-defender is given
    // the enemy CARRIER, so a defenderless team still denies the carry instead of watching
    // it walk home. Each role commits in character — a body-block dive (defender/assassin),
    // a close chase (tracker), or a wary poke (sage). For defender-having teams this is
    // exact R1 parity (the carrier is always claimed by a defender).
    const peelId = squad.peel[f.id];
    const peelTgt = peelId ? enemies.find((e) => e.id === peelId) ?? null : null;
    if (peelTgt) {
        const w = PEEL_SCORE[f.role];
        if (peelTgt.carrying) {
            const plan = f.role === "sage" ? pokeP(peelTgt, cfg.neutral) : diveP(peelTgt, f.role === "tracker" ? 0.5 : 0.2);
            cands.push({ score: w.carrier, kind: "interceptCarrier", plan });
        }
        else {
            const plan = f.role === "defender" ? pokeP(peelTgt, cfg.neutral) : huntP(f, peelTgt, cfg.neutral);
            cands.push({ score: w.diver, kind: "interceptAssassin", plan });
        }
    }
    // Objective: contest the open scroll, OR pre-position for an imminent spawn
    // (scroll.x/y = the spawn point). Tracker/Defender weigh it hardest. Weights are
    // high + the distance falloff is MILD, so the squad actually travels to the
    // centre and converges on the scroll instead of ignoring it from across the map.
    if (ctx.scrollOpen || ctx.scrollSoon) {
        const w = f.role === "tracker" ? 78 : f.role === "defender" ? 72 : f.role === "assassin" ? 48 : 38;
        const dS = distPt(f, scroll.x, scroll.y);
        const score = ctx.scrollOpen ? w + (dS <= PICKUP_RANGE ? 45 : -dS * 0.6) : w * 0.85 - dS * 0.5; // anticipation softer
        cands.push({ score, kind: "objective", plan: ctx.scrollOpen ? contestP(f, fs, scroll) : anticipateP(f, fs, scroll) });
    }
    if (f.role === "defender") {
        if (ctx.myCarrier && ctx.myCarrier.id !== f.id) {
            const th = nearestPt(ctx.myCarrier.x, ctx.myCarrier.y, enemies);
            const mx = th ? (ctx.myCarrier.x + th.x) / 2 : ctx.myCarrier.x, my = th ? (ctx.myCarrier.y + th.y) / 2 : ctx.myCarrier.y;
            cands.push({ score: ctx.leadLives >= 3 ? 115 : 100, kind: "escort", plan: { gx: mx, gy: my, stopAt: 0, target: th, channel: false } }); // escort carrier
            if (th && dist(th, ctx.myCarrier) < 3)
                cands.push({ score: 75, kind: "protectCarrier", plan: diveP(th, 0.2) }); // protect carrier
        }
        // Generic intercept fallback — only when the blackboard didn't already assign me a
        // peel (handled in the shared PEEL block above), so coverage never doubles up.
        if (!peelTgt) {
            const asn = assassinThreat(f, fs);
            if (asn)
                cands.push({ score: 50, kind: "interceptAssassin", plan: pokeP(asn, cfg.neutral) }); // intercept assassin
            if (ctx.enemyCarrier)
                cands.push({ score: 55, kind: "interceptCarrier", plan: diveP(ctx.enemyCarrier, 0.2) }); // intercept enemy carrier
        }
        const sage = alliesAlive(f, fs, false).find((a) => a.role === "sage");
        if (sage) {
            const st = nearestPt(sage.x, sage.y, enemies);
            if (st && dist(st, sage) < 4)
                cands.push({ score: 40, kind: "protectSage", plan: { gx: (sage.x + st.x) / 2, gy: (sage.y + st.y) / 2, stopAt: 0, target: st, channel: false } });
        }
        const near = nearestEnemy(f, fs);
        if (near)
            cands.push({ score: 25 + stick(near) + fire(near) + callBonus(near), kind: "frontline", plan: huntP(f, near, cfg.neutral) }); // frontline nearest threat
    }
    else if (f.role === "tracker") {
        if (ctx.enemyCarrier)
            cands.push(huntC(ctx.enemyCarrier, 80)); // hunt carrier
        for (const e of enemies) {
            const hf = hpFrac(e);
            if (hf < 0.30)
                cands.push(huntC(e, 70)); // execute
            else if (hf < 0.50)
                cands.push(huntC(e, 50)); // pressure
        }
        if (ctx.myCarrier && ctx.myCarrier.id !== f.id)
            cands.push({ score: 40, kind: "escort", plan: pokeP(ctx.myCarrier, 1.6) }); // escort
        const tt = threatTarget(f, enemies);
        if (tt)
            cands.push(huntC(tt, 30)); // highest-value enemy
        if (hpFrac(f) < 0.25 && countWithin(f.x, f.y, enemies, 4.5) >= 2)
            cands.push({ score: 75, kind: "retreat", plan: retreatP(f, fs) });
    }
    else if (f.role === "assassin") {
        for (const e of enemies) {
            let s;
            if (e.role === "sage")
                s = 100; // kill the sage
            else if (ctx.enemyCarrier && e.id === ctx.enemyCarrier.id)
                s = 95; // kill the carrier
            else if (hpFrac(e) < 0.40)
                s = 80; // execute
            else if (e.role === "tracker")
                s = 50; // ambush tracker
            else if (e.role === "defender")
                continue; // ignore defenders
            else
                s = 30;
            cands.push(huntC(e, s));
        }
        if (hpFrac(f) < 0.30)
            cands.push({ score: 120, kind: "retreat", plan: retreatP(f, fs) }); // disengage immediately when hurt
        else if (countWithin(f.x, f.y, enemies, 3.0) >= 2 && hpFrac(f) < 0.6)
            cands.push({ score: 70, kind: "retreat", plan: retreatP(f, fs) });
    }
    else { // sage — survival-focused support; never leads
        const allies = alliesAlive(f, fs, true);
        const hurt = allies.reduce((b, a) => (b === null || hpFrac(a) < hpFrac(b) ? a : b), null);
        const defender = allies.find((a) => a.role === "defender" && a.id !== f.id) ?? null;
        const anchor = defender ?? nearestPt(f.x, f.y, alliesAlive(f, fs, false));
        if (hurt && hpFrac(hurt) < 0.25)
            cands.push({ score: 100, kind: "protectAlly", plan: behindP(f, hurt, null) }); // emergency heal positioning
        if (ctx.myCarrier)
            cands.push({ score: 90, kind: "protectCarrier", plan: behindP(f, ctx.myCarrier, null) }); // protect carrier
        if (hurt && hpFrac(hurt) < 0.50)
            cands.push({ score: 75, kind: "support", plan: behindP(f, hurt, null) }); // heal
        if (anchor)
            cands.push({ score: 50, kind: "support", plan: behindP(f, anchor, nearestEnemy(f, fs)) }); // buff / stay behind defender
        if (assassinThreat(f, fs))
            cands.push({ score: 40, kind: "retreat", plan: retreatP(f, fs) }); // escape an assassin
        if (hpFrac(f) < 0.25)
            cands.push({ score: 95, kind: "retreat", plan: retreatP(f, fs) }); // survival
        if (anchor)
            cands.push({ score: 18, kind: "support", plan: behindP(f, anchor, nearestEnemy(f, fs)) }); // fallback
    }
    if (cands.length === 0) {
        const near = nearestEnemy(f, fs);
        cands.push(near ? { score: 1, kind: "frontline", plan: huntP(f, near, cfg.neutral) } : { score: 0, kind: "support", plan: { gx: f.x, gy: f.y, stopAt: 0, target: null, channel: false } });
    }
    return cands;
}
// Match-state rubber-band: nudge candidate scores by KIND so a viewer sees the team
// shift posture with the scoreboard. Ahead → protect/group; behind → force fights;
// match point → the objective + the enemy carrier are everything.
const PHASE_ADJ = {
    normal: {},
    closeit: { escort: 18, protectCarrier: 18, protectAlly: 14, protectSage: 12, regroup: 12, support: 8, hunt: -10, frontline: -8 },
    comeback: { objective: 16, hunt: 12, interceptCarrier: 14, frontline: 8, retreat: -14, regroup: -10 },
    emergency: { objective: 30, protectCarrier: 30, interceptCarrier: 36, escort: 24, hunt: -16, frontline: -16, support: -8 },
};
// Power POSTURE (R3): the commander's board read nudges intent KINDs — PRESS to
// CONVERT a winning board (collapse on kills + push the objective, stop disengaging),
// REGROUP to re-form a losing one at the rally. Modest like TRAIT_ADJ; stacks with the
// score-based PHASE_ADJ (orthogonal axes: scoreboard vs board-strength).
const POSTURE_ADJ = {
    press: { hunt: 9, frontline: 7, interceptCarrier: 10, objective: 8, escort: 4, retreat: -9, regroup: -10 },
    even: {},
    regroup: { regroup: 10, protectAlly: 6, support: 4, hunt: -5, frontline: -5 },
};
// Trait personality: nudges (not overrides) the role's choices by the pet's OWN
// trait, so two same-role pets play a little differently — an Aggressive one dives,
// a Loyal one guards. Mild on purpose; absent/unknown traits → no change.
const TRAIT_ADJ = {
    Aggressive: { hunt: 14, frontline: 12, interceptCarrier: 10, retreat: -14, regroup: -10 },
    Loyal: { protectCarrier: 16, protectSage: 14, protectAlly: 14, escort: 12 },
    Guardian: { protectCarrier: 12, protectSage: 12, protectAlly: 10, regroup: 10, escort: 10, hunt: -6 },
    Swift: { objective: 12, interceptCarrier: 10, interceptAssassin: 8, hunt: 6 },
    Lucky: { hunt: 8, objective: 8 },
    Battleborn: { frontline: 14, hunt: 10, retreat: -12, regroup: -8 },
};
const COMMIT_MARGIN = 12; // keep last tick's target unless another beats it by this much
function decide(f, fs, scroll, score, squad) {
    const cfg = ROLE_CFG[f.role];
    if (f.carrying)
        return carryHome(f, fs); // carrier behavior tree
    if (f.tauntLeft > 0 && f.tauntBy) { // forced taunt overrides
        const tn = fs.find((g) => g.id === f.tauntBy && alive(g));
        if (tn) {
            f.aiTargetId = tn.id;
            return { gx: tn.x, gy: tn.y, stopAt: cfg.neutral, target: tn, channel: false };
        }
    }
    const ctx = makeCtx(f, fs, scroll, score);
    const cands = candidates(f, fs, scroll, ctx, squad);
    const adj = PHASE_ADJ[ctx.phase];
    for (const c of cands) {
        const a = adj[c.kind];
        if (a)
            c.score += a;
    } // match-state rubber-band (scoreboard)
    const padj = POSTURE_ADJ[squad.posture[f.team]]; // commander posture (board strength)
    for (const c of cands) {
        const a = padj[c.kind];
        if (a)
            c.score += a;
    }
    const tadj = f.pet.trait ? TRAIT_ADJ[f.pet.trait] : undefined; // trait personality
    if (tadj)
        for (const c of cands) {
            const a = tadj[c.kind];
            if (a)
                c.score += a;
        }
    let best = cands[0];
    for (let i = 1; i < cands.length; i++)
        if (cands[i].score > best.score)
            best = cands[i]; // first wins ties → deterministic
    // Sticky commitment: stay on last tick's target unless something beats it by a
    // margin — deliberate squad behaviour instead of twitchy per-tick re-targeting.
    if (f.aiTargetId) {
        let keep = null;
        for (const c of cands)
            if (c.plan.target && c.plan.target.id === f.aiTargetId && (keep === null || c.score > keep.score))
                keep = c;
        if (keep && keep.score >= best.score - COMMIT_MARGIN)
            best = keep;
    }
    f.aiTargetId = best.plan.target ? best.plan.target.id : null;
    return best.plan;
}
/** Carrier behavior tree: head home via whichever seal keeps the most distance
 *  from the nearest enemy; only fight if something's right in the way. (handoff:
 *  return home > avoid threats > stay near allies > fight only if blocked.) */
function carryHome(f, fs) {
    const enemies = enemiesAlive(f, fs);
    let best = f.seals[0], bestScore = -Infinity;
    for (const s of f.seals) {
        const ne = nearestPt(s[0], s[1], enemies);
        const dEnemy = ne ? Math.sqrt((ne.x - s[0]) * (ne.x - s[0]) + (ne.y - s[1]) * (ne.y - s[1])) : 99;
        const sc = -distPt(f, s[0], s[1]) + dEnemy * 0.5; // closer to home + farther from danger
        if (sc > bestScore) {
            bestScore = sc;
            best = s;
        }
    }
    const block = nearestEnemy(f, fs);
    return { gx: best[0], gy: best[1], stopAt: 0, target: block && dist(f, block) < f.atkRange + 0.3 ? block : null, channel: false };
}
/** Close to just inside striking range of the target. No team-dependent term, so
 *  the engagement is fair (blue/red mirror across x=0); the team fans out naturally
 *  via body-separation + role-distinct attack ranges (defender hugs, tracker/sage
 *  hang back). Going to a STABLE goal (the target itself) avoids the orbit-the-
 *  standing-spot stall that parks pets just out of reach. */
function spreadGoal(f, target, neutral) {
    return { gx: target.x, gy: target.y, stopAt: Math.min(neutral, f.atkRange) * 0.92 };
}
/** Act on the plan: channel, attack, or fire the role ability. */
function act(f, plan, fs, scroll, rng, t, events) {
    const cfg = ROLE_CFG[f.role];
    const tgt = plan.target;
    const d = tgt ? dist(f, tgt) : Infinity;
    // Role ability when ready + appropriate.
    if (f.abilityCd <= 0 && f.energy >= cfg.abilityCost) {
        if (cfg.ability === "mend") { // Sage: heal the most-hurt ally
            const ally = lowestHpAlly(f, fs);
            if (ally && ally.hp < ally.maxHp * 0.85) {
                const amt = Math.round(ally.maxHp * 0.22);
                ally.hp = Math.min(ally.maxHp, ally.hp + amt);
                ally.shieldHp = Math.max(ally.shieldHp, Math.round(ally.maxHp * 0.12));
                f.abilityCd = cfg.abilityCd * exports.ARENA_TPS;
                f.energy -= cfg.abilityCost;
                events.push({ t, type: "ability", actorId: f.id, kind: "mend" }, { t, type: "heal", targetId: ally.id, actorId: f.id, amount: amt });
                return;
            }
        }
        else if (cfg.ability === "guard" && tgt && d < cfg.neutral + 2 && (tgt.carrying || tgt.role === "assassin" || tgt.role === "tracker" || hpFrac(f) < 0.55)) { // Defender: SAVE the taunt for the carrier / a striker / when pressured
            tgt.tauntBy = f.id;
            tgt.tauntLeft = Math.round(exports.ARENA_TPS * 2.5);
            f.shieldHp = Math.max(f.shieldHp, Math.round(f.maxHp * 0.25));
            f.abilityCd = cfg.abilityCd * exports.ARENA_TPS;
            f.energy -= cfg.abilityCost;
            events.push({ t, type: "ability", actorId: f.id, kind: "guard" }, { t, type: "shield", targetId: f.id, actorId: f.id, amount: f.shieldHp });
            return;
        }
        else if (cfg.ability === "mark" && tgt && d < cfg.atkRange + 1 && (tgt.carrying || hpFrac(tgt) < 0.6 || tgt.id === f.aiTargetId)) { // Tracker: mark the carrier / the wounded / the committed kill
            tgt.markLeft = Math.round(exports.ARENA_TPS * 4);
            tgt.slowLeft = Math.max(tgt.slowLeft, Math.round(exports.ARENA_TPS * 1.5));
            f.abilityCd = cfg.abilityCd * exports.ARENA_TPS;
            f.energy -= cfg.abilityCost;
            events.push({ t, type: "ability", actorId: f.id, kind: "mark" });
            dealDamage(f, tgt, f.atk * 0.8, rng, t, events, true);
            return;
        }
        else if (cfg.ability === "assassinate" && tgt && d < 5 && d > cfg.atkRange && (tgt.carrying || tgt.role === "sage" || hpFrac(tgt) < 0.5)) { // Assassin: spend burst on the carrier / sage / a finish
            f.moveDx = (tgt.x - f.x) / d;
            f.moveDy = (tgt.y - f.y) / d;
            f.state = "dash";
            f.dashLeft = 6;
            f.abilityCd = cfg.abilityCd * exports.ARENA_TPS;
            f.energy -= cfg.abilityCost;
            events.push({ t, type: "ability", actorId: f.id, kind: "assassinate" });
            return;
        }
    }
    // Basic attack when a target is in range + line of sight.
    if (tgt && d <= f.atkRange + 0.1 && f.attackCd <= 0 && lineClear(f.x, f.y, tgt.x, tgt.y)) {
        dealDamage(f, tgt, f.atk, rng, t, events);
        f.attackCd = ATTACK_CD;
        f.state = "attack";
    }
}
// Two-phase tick (FAIRNESS): every pet first DECIDES on the frozen start-of-tick
// board, then all pets EXECUTE. If decide+move+act ran per-pet in one pass, the
// team processed second would react to the first team's same-tick moves — a
// second-mover edge that, with reactive AI, snowballs into a lopsided win rate.
function tickDecide(f, fs, scroll, score, squad) {
    // CLEANSE consumable: the first tick under any DoT/control, purge it all (once).
    if (f.itemsOn && f.cCleanse > 0 && (f.dotLeft > 0 || f.slowLeft > 0 || f.markLeft > 0 || f.tauntLeft > 0)) {
        f.dotLeft = 0;
        f.dotDmg = 0;
        f.slowLeft = 0;
        f.markLeft = 0;
        f.tauntLeft = 0;
        f.tauntBy = null;
        f.cCleanse = 0;
    }
    if (f.attackCd > 0)
        f.attackCd--;
    if (f.abilityCd > 0)
        f.abilityCd--;
    if (f.slowLeft > 0)
        f.slowLeft--;
    if (f.markLeft > 0)
        f.markLeft--;
    if (f.tauntLeft > 0)
        f.tauntLeft--;
    else
        f.tauntBy = null;
    if (f.energy < 100)
        f.energy = Math.min(100, f.energy + 18 / exports.ARENA_TPS);
    if (f.dotLeft > 0) {
        f.dotLeft--;
        if (f.dotLeft % Math.round(exports.ARENA_TPS * 0.5) === 0)
            f.hp -= f.dotDmg;
    }
    if (f.state === "dash" && f.dashLeft > 0) {
        f.plan = null;
        return;
    }
    // Periodic decisions: re-decide ~every 0.5 s (or immediately if the committed
    // target died / I picked up the scroll), and REUSE the plan in between. Movement
    // tracks the cached goal and act() keeps attacking the committed target every
    // tick, so combat stays fluid while the pet reads as deliberate, not twitchy.
    f.decisionCd--;
    const tgt = f.plan?.target ?? null;
    const stale = f.plan === null || f.decisionCd <= 0 || f.carrying || (tgt !== null && !alive(tgt)); // carrier re-routes every tick; target died → re-pick now
    if (stale) {
        f.plan = decide(f, fs, scroll, score, squad);
        f.decisionCd = DECISION_TICKS + (f.slot & 3);
    }
}
function tickExecute(f, fs, scroll, rng, t, events) {
    if (f.state === "dash" && f.dashLeft > 0) { // assassin lunge — fast, collision-aware
        f.dashLeft--;
        const nx = f.x + f.moveDx * f.moveSpeed * 3.4, ny = f.y + f.moveDy * f.moveSpeed * 3.4;
        if (walkableAt(nx, ny) && lineClear(f.x, f.y, nx, ny)) {
            f.x = nx;
            f.y = ny;
        }
        else
            f.dashLeft = 0; // dash stops at a wall, never jumps it
        if (f.dashLeft <= 0)
            f.state = "idle";
        return;
    }
    const plan = f.plan;
    if (!plan) {
        f.state = "idle";
        return;
    }
    if (plan.channel) {
        f.state = "channel";
        act(f, plan, fs, scroll, rng, t, events);
        return;
    }
    const before = { x: f.x, y: f.y };
    moveToward(f, plan.gx, plan.gy, effSpeed(f), plan.stopAt);
    const moved = Math.abs(f.x - before.x) + Math.abs(f.y - before.y) > 0.002;
    f.state = moved ? "move" : "idle";
    act(f, plan, fs, scroll, rng, t, events);
}
// ── Scroll lifecycle ─────────────────────────────────────────────────────────
function stepScroll(scroll, fs, center, t, events, score) {
    if (scroll.state === "inactive") {
        if (scroll.spawnTimer > 0)
            scroll.spawnTimer--;
        if (scroll.spawnTimer <= 0) {
            scroll.state = "center";
            scroll.x = center[0];
            scroll.y = center[1];
            scroll.channelById = null;
            scroll.channelLeft = 0;
            events.push({ t, type: "scrollspawn" });
        }
        return;
    }
    if (scroll.state === "carried") {
        const carrier = fs.find((g) => g.id === scroll.carrierId);
        if (!carrier || !alive(carrier)) { // dropped on death (handled in death pass) — guard here too
            scroll.state = "dropped";
            scroll.dropTimer = SCROLL_DROP_LIFE;
            scroll.carrierId = null;
            if (carrier)
                carrier.carrying = false;
            return;
        }
        scroll.x = carrier.x;
        scroll.y = carrier.y;
        const [bx, by] = nearestSeal(carrier);
        if (distPt(carrier, bx, by) <= BASE_SCORE_RANGE) { // SCORE the capture
            score[carrier.team] += 1;
            carrier.carrying = false; // each capture = 1 point (race to 5)
            scroll.state = "inactive";
            scroll.spawnTimer = SCROLL_RESPAWN;
            scroll.carrierId = null;
            scroll.x = center[0];
            scroll.y = center[1]; // park at the spawn point so the next anticipation aims true
            events.push({ t, type: "capture", team: carrier.team, actorId: carrier.id });
        }
        return;
    }
    // center or dropped → channelling to pick up
    if (scroll.state === "dropped") {
        if (scroll.dropTimer > 0)
            scroll.dropTimer--;
        if (scroll.dropTimer <= 0) {
            scroll.state = "inactive";
            scroll.spawnTimer = SCROLL_RESPAWN;
            scroll.channelById = null;
            scroll.x = center[0];
            scroll.y = center[1];
            return;
        }
    }
    const chan = scroll.channelById ? fs.find((g) => g.id === scroll.channelById) : null;
    if (chan && (!alive(chan) || distPt(chan, scroll.x, scroll.y) > PICKUP_RANGE + 0.2)) {
        scroll.channelById = null;
        scroll.channelLeft = 0;
    }
    if (!scroll.channelById) { // claim by the closest channeller (deterministic: lowest id)
        const cands = fs.filter((g) => alive(g) && distPt(g, scroll.x, scroll.y) <= PICKUP_RANGE).sort((a, b) => (a.id < b.id ? -1 : 1));
        if (cands.length) {
            scroll.channelById = cands[0].id;
            scroll.channelLeft = SCROLL_CHANNEL;
        }
    }
    if (scroll.channelById) {
        scroll.channelLeft--;
        if (scroll.channelLeft <= 0) {
            const c = fs.find((g) => g.id === scroll.channelById);
            scroll.state = "carried";
            scroll.carrierId = c.id;
            c.carrying = true;
            scroll.channelById = null;
            events.push({ t, type: "pickup", actorId: c.id, team: c.team });
        }
    }
}
function snap(t, fs, scroll, score) {
    return {
        t,
        actors: fs.map((f) => {
            const statuses = [];
            if (f.shieldHp > 0)
                statuses.push("shield");
            if (f.slowLeft > 0)
                statuses.push("slow");
            if (f.markLeft > 0)
                statuses.push("mark");
            if (f.tauntLeft > 0)
                statuses.push("taunt");
            if (f.carrying)
                statuses.push("carry");
            return { id: f.id, team: f.team, slot: f.slot, role: f.role, element: f.element, x: quant(f.x), y: quant(f.y), faceX: quant(f.faceX), faceY: quant(f.faceY), hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp, energy: Math.round(f.energy), lives: f.lives, state: f.state, carrying: f.carrying, statuses };
        }),
        scroll: { state: scroll.state, x: quant(scroll.x), y: quant(scroll.y), carrierId: scroll.carrierId, channelFrac: scroll.channelById ? 1 - scroll.channelLeft / SCROLL_CHANNEL : 0 },
        scoreBlue: score.blue, scoreRed: score.red,
    };
}
/** Run a full deterministic match. `blue`/`red` are role-assigned rosters (2 or 4 each). */
function runPetArenaMatch(blue, red, seed, applyItems = false) {
    const rng = makeRng(seed);
    const nB = blue.length, nR = red.length;
    // applyItems (PvP ladder) equips every pet's PVP gear + consumables symmetrically.
    const fs = [
        ...blue.map((s, i) => buildFighter(s.pet, "blue", s.role, i, nB, applyItems)),
        ...red.map((s, i) => buildFighter(s.pet, "red", s.role, i, nR, applyItems)),
    ];
    const center = ARENA_CENTER; // on the painted center paw (measured off the art)
    const sepX = new Array(fs.length).fill(0), sepY = new Array(fs.length).fill(0); // per-tick body-separation accumulators (reused; see the declump pass)
    const scroll = { state: "inactive", x: center[0], y: center[1], carrierId: null, channelById: null, channelLeft: 0, spawnTimer: exports.SCROLL_FIRST_SPAWN, dropTimer: 0 };
    const score = { blue: 0, red: 0 };
    const snapshots = [];
    const events = [];
    let winner = "draw";
    let ticks = 0;
    for (let t = 0; t < MAX_TICKS; t++) {
        ticks = t + 1;
        // respawn timers
        for (const f of fs)
            if (f.state === "respawning") {
                if (--f.respawnLeft <= 0) {
                    const [x, y] = snapMain(f.baseX, f.baseY + (f.slot - 1.5) * 1.0);
                    f.x = x;
                    f.y = y;
                    f.hp = f.maxHp;
                    f.energy = 100;
                    f.shieldHp = 0;
                    f.slowLeft = f.dotLeft = f.markLeft = f.tauntLeft = 0;
                    f.tauntBy = null;
                    f.state = "idle";
                    f.path = null;
                    f.navAge = 0;
                    f.stuckTicks = 0;
                    events.push({ t, type: "respawn", actorId: f.id, team: f.team });
                }
            }
        // Decide on a frozen start-of-tick board (no second-mover advantage), then
        // execute in an order that ALTERNATES each tick (forward = blue-first,
        // reverse = red-first) so neither team gets a persistent same-tick first-
        // strike. Deterministic (keyed on the tick). NOTE: with stat-IDENTICAL
        // rosters a small side-lean remains (a symmetric-map artifact of attack
        // timing), but a clearly stronger team wins from EITHER side (verified), so
        // real matches — player pets vs AI pets, never identical — are decided by
        // pet quality, not side.
        const squad = buildSquad(fs, scroll); // shared squad awareness (focus + call + peels) + commander (posture + rally) — built once per tick
        for (const f of fs)
            if (alive(f))
                tickDecide(f, fs, scroll, score, squad);
        for (let k = 0; k < fs.length; k++) {
            const f = (t & 1) === 0 ? fs[k] : fs[fs.length - 1 - k];
            if (alive(f))
                tickExecute(f, fs, scroll, rng, t, events);
        }
        // Separate overlapping bodies. Accumulate every pair's push from the FROZEN
        // start-of-pass positions, then apply once and DAMPED — so a dense scrum (3-4
        // pets contesting the scroll / jammed in a choke) eases into a stable ring
        // instead of order-dependent compounding shoves that ping-pong each pet against
        // its moveToward pull. That ping-pong read as pets "vibrating in place" and —
        // because the depth scale is tied to y — pulsing big↔small. The equilibrium
        // spacing (1.5) is unchanged; only the transient is calmer (gap closes ~half/tick).
        for (let i = 0; i < fs.length; i++) {
            sepX[i] = 0;
            sepY[i] = 0;
        }
        for (let i = 0; i < fs.length; i++)
            for (let j = i + 1; j < fs.length; j++) {
                const a = fs[i], b = fs[j];
                if (!alive(a) || !alive(b))
                    continue;
                const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy);
                if (d >= 1.5 || d < 1e-6)
                    continue;
                const push = (1.5 - d) * 0.25, ux = dx / d, uy = dy / d; // 0.25/pet ⇒ ~half the gap per tick (was a full-gap snap, applied per-pair in sequence)
                sepX[i] -= ux * push;
                sepY[i] -= uy * push;
                sepX[j] += ux * push;
                sepY[j] += uy * push;
            }
        for (let i = 0; i < fs.length; i++) {
            const f = fs[i];
            if (!alive(f) || (sepX[i] === 0 && sepY[i] === 0))
                continue;
            const nx = f.x + sepX[i], ny = f.y + sepY[i];
            if (walkableAt(nx, ny)) {
                f.x = nx;
                f.y = ny;
            } // slide along a wall if the diagonal is blocked (never wedge)
            else if (walkableAt(nx, f.y))
                f.x = nx;
            else if (walkableAt(f.x, ny))
                f.y = ny;
        }
        // deaths → score, life, respawn, drop scroll
        for (const f of fs) {
            if (f.hp > 0 || f.state === "respawning" || f.state === "dead")
                continue;
            const killer = lastAttacker(events, f.id) ?? f.team;
            const killTeam = killer === "blue" || killer === "red" ? killer : (f.team === "blue" ? "red" : "blue");
            events.push({ t, type: "kill", targetId: f.id, actorId: "", team: killTeam }); // kills DON'T score — purely tactical (clear the path / defend the carry)
            if (f.carrying) {
                f.carrying = false;
                scroll.state = "dropped";
                scroll.dropTimer = SCROLL_DROP_LIFE;
                scroll.carrierId = null;
                scroll.x = f.x;
                scroll.y = f.y;
                events.push({ t, type: "drop", actorId: f.id });
            }
            f.lives -= 1;
            if (f.lives <= 0) {
                f.state = "dead";
            }
            else {
                f.state = "respawning";
                f.respawnLeft = RESPAWN_TICKS;
            }
        }
        for (const f of fs) {
            f.x = quant(clamp(f.x, -exports.ARENA_X, exports.ARENA_X));
            f.y = quant(clamp(f.y, -exports.ARENA_Y, exports.ARENA_Y));
        }
        stepScroll(scroll, fs, center, t, events, score);
        snapshots.push(snap(t, fs, scroll, score));
        // win checks
        if (score.blue >= exports.WIN_SCORE || score.red >= exports.WIN_SCORE) {
            winner = score.blue >= exports.WIN_SCORE ? "blue" : "red";
            break;
        }
        const blueUp = fs.some((f) => f.team === "blue" && f.lives > 0), redUp = fs.some((f) => f.team === "red" && f.lives > 0);
        if (!blueUp || !redUp) {
            winner = blueUp ? "blue" : redUp ? "red" : "draw";
            break;
        }
    }
    // Time-cap (or simultaneous-wipe) tiebreaker: higher score, then more total
    // remaining lives+HP — so a cap-reached match almost never ends a flat "draw".
    if (winner === "draw") {
        if (score.blue !== score.red)
            winner = score.blue > score.red ? "blue" : "red";
        else {
            const tally = (team) => fs.reduce((s, f) => (f.team === team ? s + Math.max(0, f.lives) * 5000 + Math.max(0, f.hp) : s), 0);
            const tb = tally("blue"), tr = tally("red");
            winner = tb > tr ? "blue" : tr > tb ? "red" : "draw";
        }
    }
    return { winner, scoreBlue: score.blue, scoreRed: score.red, ticks, snapshots, events, bases: { blue: SEALS.blue, red: SEALS.red }, center };
}
/** The team of the most recent hit on `id` (kill credit). Scans events backward. */
function lastAttacker(events, id) {
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e.type === "hit" && e.targetId === id)
            return e.actorId.startsWith("blue") ? "blue" : "red";
    }
    return null;
}

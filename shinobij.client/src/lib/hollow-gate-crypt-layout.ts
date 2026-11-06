/**
 * Hollow Gate — "crypt" floor layout: painted prefab rooms on a room graph.
 *
 * The way roguelikes that feel hand-made build floors (Enter the Gungeon's
 * flows and prefab rooms are the best documented example): every room is a
 * finished, painted prefab whose doorways are painted into the art, and the
 * generator only decides which rooms exist and how they connect.
 *
 *   prefabs   a 7 x 5 chamber (doorways at the middle of each side) and a
 *             15 x 5 hall spanning two slots (doorways at both halves' north
 *             and south, and at each end). The painting covers the whole room.
 *   slots     a 4 x 3 grid of room slots on the 31 x 21 board. Doorways of
 *             neighbouring slots line up, joined by a short painted passage.
 *   graph     a randomized depth-first tree from the entrance (long branches,
 *             dead ends), one or two extra links for loops, a slot or two
 *             left as solid rock, and the deepest pair of slots merged into
 *             the stair hall. Some floors get a second hall.
 *   unused    a doorway that leads nowhere is filled with rock (a wall cell),
 *             which the renderer paints as a rubble fall.
 *
 * Geometry only: the floor generator still marks doors, assigns room roles and
 * places exactly the content the server's floor seal expects. Pure and
 * deterministic for a given rng.
 */
import type { HollowGateTerrain } from "../types/character";
import type { BSPRect } from "./hollow-gate-bsp";

export type CryptPrefab = "room" | "small" | "hall";
export const HOLLOW_GATE_CRYPT_DIMS = { width: 31, height: 21 } as const;

export type HollowGateCryptLayout = {
    terrain: HollowGateTerrain[];
    roomIds: number[];
    rooms: BSPRect[];
    anchors: Array<{ x: number; y: number }>;
    prefabs: CryptPrefab[];
    /** The entrance (always room 0) and the stair hall. */
    stairRoom: number;
};

const COLS = 4, ROWS = 3;
const slotX = (i: number) => 8 * i;           // slot i spans x .. x + 6
const slotY = (j: number) => 1 + 7 * j;       // slot j spans y .. y + 4
const key = (i: number, j: number) => j * COLS + i;

/** Build a crypt layout, or null when the board is not the crypt board. */
export function hollowGateCryptLayout(w: number, h: number, rng: () => number): HollowGateCryptLayout | null {
    if (w !== HOLLOW_GATE_CRYPT_DIMS.width || h !== HOLLOW_GATE_CRYPT_DIMS.height) return null;
    const flipX = rng() < 0.5, flipY = rng() < 0.5;
    const slots = [...Array(COLS * ROWS).keys()];
    const neighbours = (s: number) => {
        const i = s % COLS, j = Math.floor(s / COLS), out: number[] = [];
        if (i > 0) out.push(key(i - 1, j));
        if (i < COLS - 1) out.push(key(i + 1, j));
        if (j > 0) out.push(key(i, j - 1));
        if (j < ROWS - 1) out.push(key(i, j + 1));
        return out;
    };
    const shuffle = <T,>(a: T[]) => { for (let k = a.length - 1; k > 0; k -= 1) { const r = Math.floor(rng() * (k + 1)); [a[k], a[r]] = [a[r], a[k]]; } return a; };

    // ── Which slots exist: one or two are left as solid rock (never the entrance).
    const entrance = key(0, Math.floor(rng() * ROWS));
    let used = new Set(slots);
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const drop = shuffle(slots.filter((s) => s !== entrance)).slice(0, 1 + (rng() < 0.45 ? 1 : 0));
        const candidate = new Set(slots.filter((s) => !drop.includes(s)));
        const seen = new Set([entrance]), queue = [entrance];
        while (queue.length) for (const n of neighbours(queue.shift()!)) if (candidate.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
        if (seen.size === candidate.size) { used = candidate; break; }
    }

    // ── Randomized depth-first tree from the entrance: long branches, dead ends.
    const edges = new Set<string>();
    const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const depth = new Map<number, number>([[entrance, 0]]);
    const stack = [entrance];
    while (stack.length) {
        const s = stack[stack.length - 1];
        const next = shuffle(neighbours(s).filter((n) => used.has(n) && !depth.has(n)))[0];
        if (next === undefined) { stack.pop(); continue; }
        edges.add(edgeKey(s, next));
        depth.set(next, depth.get(s)! + 1);
        stack.push(next);
    }
    // Loops: one or two extra links between neighbouring slots.
    const spare = shuffle(slots.flatMap((s) => neighbours(s).filter((n) => n > s && used.has(s) && used.has(n) && !edges.has(edgeKey(s, n))).map((n) => [s, n] as const)));
    for (const [a, b] of spare.slice(0, 1 + (rng() < 0.4 ? 1 : 0))) edges.add(edgeKey(a, b));

    // ── Halls: the deepest pair of side-by-side slots becomes the stair hall;
    //    some floors merge a second pair into a plain hall.
    const pairs = slots.filter((s) => s % COLS < COLS - 1 && used.has(s) && used.has(s + 1) && s !== entrance && s + 1 !== entrance)
        .map((s) => [s, s + 1] as const);
    if (!pairs.length) return null;
    const pairDepth = ([a, b]: readonly [number, number]) => Math.max(depth.get(a) ?? 0, depth.get(b) ?? 0);
    const stairPair = [...pairs].sort((p, q) => pairDepth(q) - pairDepth(p) || p[0] - q[0])[0];
    const halls: Array<readonly [number, number]> = [stairPair];
    if (rng() < 0.4) {
        const other = shuffle(pairs.filter((p) => !p.some((s) => stairPair.includes(s))))[0];
        if (other) halls.push(other);
    }
    edges.delete(edgeKey(...stairPair));
    for (const hall of halls) edges.delete(edgeKey(...hall));

    // ── Stamp rooms. Room 0 is the entrance; the stair hall is recorded.
    const total = w * h;
    const terrain: HollowGateTerrain[] = new Array(total).fill("wall");
    const roomIds: number[] = new Array(total).fill(-1);
    const rooms: BSPRect[] = [], anchors: Array<{ x: number; y: number }> = [], prefabs: CryptPrefab[] = [];
    const roomOfSlot = new Map<number, number>();
    const mx = (x: number) => (flipX ? w - 1 - x : x), my = (y: number) => (flipY ? h - 1 - y : y);
    const at = (x: number, y: number) => my(y) * w + mx(x);
    const order = [entrance, ...slots.filter((s) => s !== entrance && used.has(s))];
    const slotRect = new Map<number, BSPRect>();
    for (const s of order) {
        if (roomOfSlot.has(s)) continue;
        const hall = halls.find((p) => p.includes(s));
        const first = hall ? hall[0] : s;
        const i = first % COLS, j = Math.floor(first / COLS);
        // A chamber is the full 7 x 5 or, now and then, a small 5 x 5 cave
        // centred in its slot, so passages between rooms run different lengths.
        const small = !hall && s !== entrance && rng() < 0.35;
        const rect = { x: slotX(i) + (small ? 1 : 0), y: slotY(j), w: hall ? 15 : small ? 5 : 7, h: 5 };
        for (const member of hall ?? [s]) slotRect.set(member, rect);
        const id = rooms.length;
        for (let y = rect.y; y < rect.y + rect.h; y += 1) for (let x = rect.x; x < rect.x + rect.w; x += 1) {
            terrain[at(x, y)] = "room_floor"; roomIds[at(x, y)] = id;
        }
        const bx = flipX ? w - (rect.x + rect.w) : rect.x, by = flipY ? h - (rect.y + rect.h) : rect.y;
        rooms.push({ x: bx, y: by, w: rect.w, h: rect.h });
        anchors.push({ x: bx + Math.floor(rect.w / 2), y: by + Math.floor(rect.h / 2) });
        prefabs.push(hall ? "hall" : small ? "small" : "room");
        for (const member of hall ?? [s]) roomOfSlot.set(member, id);
    }

    // ── Doorways: every slot side is a painted doorway. Linked sides get a
    //    passage; the rest are filled with rock (painted as a rubble fall).
    for (const s of slots) {
        if (!used.has(s)) continue;
        const i = s % COLS, j = Math.floor(s / COLS);
        const cx = slotX(i) + 3, cy = slotY(j) + 2;
        const r = slotRect.get(s)!;
        const run = (from: number, to: number, fixed: number, horizontal: boolean): Array<[number, number]> => {
            const out: Array<[number, number]> = [];
            for (let v = from; v <= to; v += 1) out.push(horizontal ? [v, fixed] : [fixed, v]);
            return out;
        };
        const east = slotRect.get(key(i + 1, j)), west = slotRect.get(key(i - 1, j));
        const sides: Array<[number, number, number, Array<[number, number]>]> = [
            [key(i + 1, j), r.x + r.w - 1, cy, i < COLS - 1 && east ? run(r.x + r.w, east.x - 1, cy, true) : []],
            [key(i - 1, j), r.x, cy, i > 0 && west ? run(west.x + west.w, r.x - 1, cy, true) : []],
            [key(i, j + 1), cx, r.y + 4, run(r.y + 5, r.y + 6, cx, false)],
            [key(i, j - 1), cx, r.y, run(r.y - 2, r.y - 1, cx, false)],
        ];
        for (const [n, dx, dy, passage] of sides) {
            const inside = dx >= 0 && dx < w && dy >= 0 && dy < h;
            const neighbourExists = n >= 0 && n < COLS * ROWS && Math.abs((n % COLS) - i) + Math.abs(Math.floor(n / COLS) - j) === 1;
            const sameRoom = neighbourExists && roomOfSlot.get(n) === roomOfSlot.get(s);
            if (sameRoom) continue; // the inside of a hall
            if (neighbourExists && used.has(n) && edges.has(edgeKey(s, n))) {
                for (const [px, py] of passage) if (terrain[at(px, py)] === "wall") terrain[at(px, py)] = "corridor_floor";
            } else if (inside) {
                terrain[at(dx, dy)] = "wall"; roomIds[at(dx, dy)] = -1;
            }
        }
    }
    return { terrain, roomIds, rooms, anchors, prefabs, stairRoom: roomOfSlot.get(stairPair[0])! };
}

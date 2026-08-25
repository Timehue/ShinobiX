/*
 * ── Hollow Warfront — the battleground map (procedural, deterministic) ───────
 * The lane-war mode's field: a Hollow Gate BREACH has torn open at the centre
 * of a contested valley; each side holds a fortified VILLAGE OUTPOST whose
 * WARD SEAL (the kill objective) sits behind two GUARDIAN TOTEM statues at the
 * lane mouths. Two weaving lanes flank the breach, a mid corridor runs through
 * two LESSER-WARDEN shrine pads, and hollow-spawn pour from the breach until
 * its Gate Warden is slain.
 *
 * The layout is generated here as a walkmask (same '1'/'0' row-major format as
 * pet-arena-fullmask) so the SIM paths on it and the 3D floor renders FROM it —
 * the visible world and the gameplay world can never disagree. Geometry is
 * strictly x- and y-symmetric for team fairness and is identical across the
 * per-village THEMES: a theme only recolors floor/fog/light, never the mask.
 */

// A compact 64×36 field. The previous 88×48 image-extracted board spent too
// much of every match on travel and turned pets/minions into unreadable dots.
// Keep 0.4-unit square cells so simulation speed and body clearance stay easy
// to reason about while the active fight occupies substantially more screen.
export const WF_X = 32;
export const WF_Y = 18;
export const WF_COLS = 160;
export const WF_ROWS = 90;
export const WF_CELL_X = (WF_X * 2) / WF_COLS;   // 0.4
export const WF_CELL_Y = (WF_Y * 2) / WF_ROWS;   // 0.4

// ── Points of interest (blue = west, red = east; north = −y) ─────────────────
export const WF_PLAZA = { blue: [-27, 0] as const, red: [27, 0] as const, r: 4.8 };
export const WF_CORE = { blue: [-30, 0] as const, red: [30, 0] as const };          // the Ward Seal
export const WF_STATUES = {
    blue: [[-24.3, -3.2], [-24.3, 3.2]] as const,   // [north, south] base-gate Guardian Totems
    red: [[24.3, -3.2], [24.3, 3.2]] as const,
};
/** Jungle camp pads, one per quadrant: [NW, SW, NE, SE] — each home to a named
 * hollow boss (WF_MINI_NAMES) like the reference map's four jungle bosses. */
export const WF_PADS = [[-15.4, -7.4], [-15.4, 7.4], [15.4, -7.4], [15.4, 7.4]] as const;
export const WF_MINI_NAMES = ["Ancient Golem", "Crystal Behemoth", "Void Stalker", "Rift Devourer"] as const;
/** The central WARDEN ARENA: a walkable ring (disc r minus the carved centre
 * pit) that the MID LANE runs straight through, exactly like the reference. */
export const WF_LAIR = { x: 0, y: 0, r: 5.8, pitR: 2.0 };
export const WF_SPAWNS = {
    // Slot order matches the opening assignments [north, mid, south, mid].
    // Giving every fighter its own y-channel prevents the old four-body knot
    // at the two-statue base mouth.
    blue: [[-28.4, -3.0], [-28.4, -1.0], [-28.4, 3.0], [-28.4, 1.0]] as const,
    red: [[28.4, -3.0], [28.4, -1.0], [28.4, 3.0], [28.4, 1.0]] as const,
};

/** Opening fan-out targets. For the first few seconds each slot owns a short,
 * mirrored deployment corridor before normal macro calls take over. */
export const WF_DEPLOY_POINTS = {
    blue: [[-21.8, -6.2], [-20.8, -1.0], [-21.8, 6.2], [-18.8, 1.0]] as const,
    red: [[21.8, -6.2], [20.8, -1.0], [21.8, 6.2], [18.8, 1.0]] as const,
};

/** Outer-lane GUARDIAN posts — recolored MYTHIC sentinels stand here in place
 * of classic turrets (per team: [top-lane, bottom-lane]). They fight anything
 * hostile that steps into range and must fall before a lane siege reaches the
 * base gates comfortably. */
export const WF_GUARD_POSTS = {
    blue: [[-14.7, -13.4], [-14.7, 13.4]] as const,
    red: [[14.7, -13.4], [14.7, 13.4]] as const,
};

/** BUSH cover zones (jungle stealth pockets): a pet inside one is invisible to
 * enemies outside it beyond point-blank range — ambush texture, Unite-style. */
export const WF_BUSHES: ReadonlyArray<readonly [number, number, number]> = [
    [-11.5, -4.2, 1.8], [-11.5, 4.2, 1.8], [11.5, -4.2, 1.8], [11.5, 4.2, 1.8],
    [-15.4, -10.8, 2.0], [-15.4, 10.8, 2.0], [15.4, -10.8, 2.0], [15.4, 10.8, 2.0],
];
export function wfInBush(x: number, y: number): boolean {
    for (const [bx, by, br] of WF_BUSHES) {
        if ((x - bx) * (x - bx) + (y - by) * (y - by) <= br * br) return true;
    }
    return false;
}

// Lane ids: n = top, m = mid (runs through the Warden Arena), s = bottom.
export type WfLaneId = "n" | "m" | "s";

// The three lanes, west→east (reference: top arcs high, mid is the straight
// shot through the arena, bottom mirrors top).
const LANE_N: ReadonlyArray<readonly [number, number]> = [
    [-24.3, -3.2], [-21, -8.5], [-14.7, -13.4], [-7.5, -15.2], [0, -15.6], [7.5, -15.2], [14.7, -13.4], [21, -8.5], [24.3, -3.2],
];
const LANE_S: ReadonlyArray<readonly [number, number]> = LANE_N.map(([x, y]) => [x, -y] as const);
// Mid detours around the carved arena pit along the ring's north edge.
const LANE_M: ReadonlyArray<readonly [number, number]> = [
    [-24.3, 0], [-18, 0], [-11, 0], [-6.8, 0], [-3.8, -3], [0, -4], [3.8, -3], [6.8, 0], [11, 0], [18, 0], [24.3, 0],
];
export const WF_LANES: Record<WfLaneId, ReadonlyArray<readonly [number, number]>> = { n: LANE_N, m: LANE_M, s: LANE_S };

// Jungle rotation paths (west half; east mirrors): mid ↔ camp ↔ top/bottom.
const ROT_NW: ReadonlyArray<readonly [number, number]> = [[-11, 0], [-13, -3.7], [-15.4, -7.4], [-15.4, -10.7], [-14.7, -13.4]];
const ROT_SW: ReadonlyArray<readonly [number, number]> = ROT_NW.map(([x, y]) => [x, -y] as const);

const LANE_HALF_W = 2.3;       // broad enough for two full pet bodies to pass
const ROT_HALF_W = 1.8;        // jungle rotations remain clearance-safe
const CONNECTOR_HALF_W = 1.7;  // arena → top/bottom vertical connectors

// The playable field: a superellipse "stadium". Inside it the ground is SOLID
// (like Summoner's Rift) — jungle WALLS are carved out between lanes, and the
// void exists only beyond the field's rim.
export function wfInsideField(x: number, y: number): boolean {
    return Math.pow(Math.abs(x) / 30.8, 2.8) + Math.pow(Math.abs(y) / 16.7, 2.8) <= 1;
}


// ── Mask generation ──────────────────────────────────────────────────────────
function buildMask(): string {
    const grid = new Uint8Array(WF_COLS * WF_ROWS);
    const stampCircle = (cx: number, cy: number, r: number) => {
        const c0 = Math.max(0, Math.floor((cx - r + WF_X) / WF_CELL_X)), c1 = Math.min(WF_COLS - 1, Math.ceil((cx + r + WF_X) / WF_CELL_X));
        const r0 = Math.max(0, Math.floor((cy - r + WF_Y) / WF_CELL_Y)), r1 = Math.min(WF_ROWS - 1, Math.ceil((cy + r + WF_Y) / WF_CELL_Y));
        for (let rr = r0; rr <= r1; rr++) {
            for (let cc = c0; cc <= c1; cc++) {
                const x = (cc + 0.5) * WF_CELL_X - WF_X, y = (rr + 0.5) * WF_CELL_Y - WF_Y;
                if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 1e-6) grid[rr * WF_COLS + cc] = 1;   // epsilon: keeps boundary cells x-mirror-exact
            }
        }
    };
    const stampPath = (pts: ReadonlyArray<readonly [number, number]>, halfW: number) => {
        for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
            const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));   // deterministic (no Math.hypot — engine-varying)
            const steps = Math.max(1, Math.ceil(len / (Math.min(WF_CELL_X, WF_CELL_Y) * 0.5)));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                stampCircle(ax + (bx - ax) * t, ay + (by - ay) * t, halfW);
            }
        }
    };

    const carveEllipse = (cx: number, cy: number, rx: number, ry: number) => {
        const c0 = Math.max(0, Math.floor((cx - rx + WF_X) / WF_CELL_X)), c1 = Math.min(WF_COLS - 1, Math.ceil((cx + rx + WF_X) / WF_CELL_X));
        const r0 = Math.max(0, Math.floor((cy - ry + WF_Y) / WF_CELL_Y)), r1 = Math.min(WF_ROWS - 1, Math.ceil((cy + ry + WF_Y) / WF_CELL_Y));
        for (let rr = r0; rr <= r1; rr++) {
            for (let cc = c0; cc <= c1; cc++) {
                const x = (cc + 0.5) * WF_CELL_X - WF_X, y = (rr + 0.5) * WF_CELL_Y - WF_Y;
                const dx = (x - cx) / rx, dy = (y - cy) / ry;
                if (dx * dx + dy * dy <= 1) grid[rr * WF_COLS + cc] = 0;
            }
        }
    };

    // 1) Begin with one clean, solid stadium. The former mask was extracted
    // from a painting; image speckle became gameplay walls and hundreds of
    // noisy black cut-outs. Authored wall islands now create the jungle while
    // leaving broad, legible fighting space between them.
    for (let rr = 0; rr < WF_ROWS; rr++) {
        for (let cc = 0; cc < WF_COLS; cc++) {
            const x = (cc + 0.5) * WF_CELL_X - WF_X, y = (rr + 0.5) * WF_CELL_Y - WF_Y;
            if (wfInsideField(x, y)) grid[rr * WF_COLS + cc] = 1;
        }
    }
    // 2) Smooth, mirrored wall masses. Routes are stamped after carving, so a
    // wall can frame a lane but can never nick or sever it.
    for (const sx of [-1, 1] as const) for (const sy of [-1, 1] as const) {
        carveEllipse(sx * 22, sy * 6.8, 2.8, 2.2);
        carveEllipse(sx * 13.2, sy * 6.5, 3.9, 2.8);
        carveEllipse(sx * 6.4, sy * 10.5, 3.2, 2.25);
    }
    carveEllipse(0, -11.7, 3.7, 2.0);
    carveEllipse(0, 11.7, 3.7, 2.0);

    // 3) Re-stamp every route/POI walkable — roads cut through the jungle, so
    // connectivity is guaranteed no matter how the walls fall.
    stampCircle(WF_PLAZA.blue[0], WF_PLAZA.blue[1], WF_PLAZA.r);
    stampCircle(WF_PLAZA.red[0], WF_PLAZA.red[1], WF_PLAZA.r);
    stampCircle(WF_LAIR.x, WF_LAIR.y, WF_LAIR.r);
    for (const [px, py] of WF_PADS) stampCircle(px, py, 2.8);
    for (const team of ["blue", "red"] as const) for (const [gx, gy] of WF_GUARD_POSTS[team]) stampCircle(gx, gy, 2.3);
    for (const [bx, by, br] of WF_BUSHES) stampCircle(bx, by, br);
    stampPath(LANE_N, LANE_HALF_W);
    stampPath(LANE_S, LANE_HALF_W);
    stampPath(LANE_M, LANE_HALF_W);
    // The mirrored SOUTH detour around the arena pit — mid flows around both
    // sides of the Warden Arena like the reference's ring.
    stampPath(LANE_M.map(([x, y]) => [x, -y] as const), LANE_HALF_W);
    // Jungle rotations in all four quadrants (mirror the west pair east).
    for (const path of [ROT_NW, ROT_SW]) {
        stampPath(path, ROT_HALF_W);
        stampPath(path.map(([x, y]) => [-x, y] as const), ROT_HALF_W);
    }
    // Arena ↔ top/bottom staircase connectors (the reference's N/S steps).
    stampPath([[0, -WF_LAIR.r + 0.8], [0, -15.6]], CONNECTOR_HALF_W);
    stampPath([[0, WF_LAIR.r - 0.8], [0, 15.6]], CONNECTOR_HALF_W);
    // Separate deployment corridors keep all four fighters moving from frame
    // one instead of asking a single BFS lane to resolve a base-gate dogpile.
    for (const team of ["blue", "red"] as const) {
        for (let i = 0; i < WF_SPAWNS[team].length; i++) {
            stampPath([WF_SPAWNS[team][i], WF_DEPLOY_POINTS[team][i]], 1.25);
        }
    }
    // Statue mouths — room to fight around each base gate.
    for (const team of ["blue", "red"] as const) for (const [sx, sy] of WF_STATUES[team]) stampCircle(sx, sy, 2.0);
    // Carve the arena's centre pit: the Warden hovers over the void and the
    // fight (and mid lane) flows around the ring.
    const pit = WF_LAIR.pitR;
    {
        const c0 = Math.floor((-pit + WF_X) / WF_CELL_X), c1 = Math.ceil((pit + WF_X) / WF_CELL_X);
        const r0 = Math.floor((-pit + WF_Y) / WF_CELL_Y), r1 = Math.ceil((pit + WF_Y) / WF_CELL_Y);
        for (let rr = r0; rr <= r1; rr++) {
            for (let cc = c0; cc <= c1; cc++) {
                const x = (cc + 0.5) * WF_CELL_X - WF_X, y = (rr + 0.5) * WF_CELL_Y - WF_Y;
                if (x * x + y * y <= pit * pit + 1e-6) grid[rr * WF_COLS + cc] = 0;
            }
        }
    }

    // Enforce exact x/y mirror symmetry (OR). The old board was only x-fair;
    // symmetric lanes make slot assignment and clearance regressions much
    // easier to detect and prevent top/bottom route bias too.
    for (let rr = 0; rr < Math.ceil(WF_ROWS / 2); rr++) {
        for (let cc = 0; cc < Math.ceil(WF_COLS / 2); cc++) {
            const mirrors = [
                rr * WF_COLS + cc,
                rr * WF_COLS + (WF_COLS - 1 - cc),
                (WF_ROWS - 1 - rr) * WF_COLS + cc,
                (WF_ROWS - 1 - rr) * WF_COLS + (WF_COLS - 1 - cc),
            ];
            const v = mirrors.reduce((value, index) => value | grid[index], 0);
            for (const index of mirrors) grid[index] = v;
        }
    }
    // Keep only the component reachable from the blue spawn — extraction
    // speckle must never leave stranded walkable islands.
    const keep = new Uint8Array(WF_COLS * WF_ROWS);
    const sc = Math.floor((WF_SPAWNS.blue[0][0] + WF_X) / WF_CELL_X), sr = Math.floor((WF_SPAWNS.blue[0][1] + WF_Y) / WF_CELL_Y);
    const queue = [sr * WF_COLS + sc];
    keep[queue[0]] = 1;
    let qi = 0;
    while (qi < queue.length) {
        const cur = queue[qi++];
        const c = cur % WF_COLS, r = (cur - c) / WF_COLS;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nc = c + dc, nr = r + dr;
            if (nc < 0 || nr < 0 || nc >= WF_COLS || nr >= WF_ROWS) continue;
            const idx = nr * WF_COLS + nc;
            if (grid[idx] && !keep[idx]) { keep[idx] = 1; queue.push(idx); }
        }
    }
    let out = "";
    for (let i = 0; i < grid.length; i++) out += grid[i] && keep[i] ? "1" : "0";
    return out;
}

/** Row-major '1'/'0' walkmask — same format as pet-arena-fullmask. Built once
 * at module init; pure function of the constants above (no RNG). */
export const WF_MASK: string = buildMask();

export const wfCellWalkable = (c: number, r: number): boolean =>
    c >= 0 && r >= 0 && c < WF_COLS && r < WF_ROWS && WF_MASK.charCodeAt(r * WF_COLS + c) === 49;

/** Whether an entity centre has a square clearance footprint around it. Kept
 * beside the map so tests and the authoritative sim use the same definition. */
export function wfClearanceWalkable(c: number, r: number, clearanceCells = 2): boolean {
    for (let dr = -clearanceCells; dr <= clearanceCells; dr++) {
        for (let dc = -clearanceCells; dc <= clearanceCells; dc++) {
            if (!wfCellWalkable(c + dc, r + dr)) return false;
        }
    }
    return true;
}

export function wfWalkable(x: number, y: number): boolean {
    if (x < -WF_X || x > WF_X || y < -WF_Y || y > WF_Y) return false;
    return wfCellWalkable(Math.floor((x + WF_X) / WF_CELL_X), Math.floor((y + WF_Y) / WF_CELL_Y));
}

/** Marching route for a hollow-spawn mob: the arena/connector exit, then lane
 * waypoints toward the target base, ending at a base-gate totem. Mid-lane mobs
 * pour straight out of the Warden Arena ring; top/bottom exit via the stairs. */
export function wfMobRoute(lane: WfLaneId, toward: "blue" | "red"): Array<[number, number]> {
    const pts = WF_LANES[lane];
    const mid = Math.floor(pts.length / 2);
    const half = toward === "blue"
        ? pts.slice(0, mid + 1).reverse()
        : pts.slice(mid);
    const statue = WF_STATUES[toward][lane === "s" ? 1 : 0];   // n+m → north gate, s → south gate
    const sgn = lane === "n" ? -1 : 1;
    const head: Array<[number, number]> = lane === "m"
        ? []
        : [[0, sgn * (WF_LAIR.r - 0.8)], [0, sgn * 14], [pts[mid][0], pts[mid][1]]];
    return [...head, ...half.map(([x, y]) => [x, y] as [number, number]), [statue[0], statue[1]]];
}

/** Distance from a point to the nearest lane centreline — the renderer paves
 * tiles within the lane width as ROADS so the three lanes read at a glance. */
export function wfLaneDistance(x: number, y: number): number {
    let best = Infinity;
    for (const lane of [WF_LANES.n, WF_LANES.m, WF_LANES.s]) {
        for (let i = 0; i < lane.length - 1; i++) {
            const [ax, ay] = lane[i], [bx, by] = lane[i + 1];
            const vx = bx - ax, vy = by - ay;
            const len2 = vx * vx + vy * vy || 1;
            let t = ((x - ax) * vx + (y - ay) * vy) / len2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = x - (ax + vx * t), dy = y - (ay + vy * t);
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < best) best = d;
        }
    }
    return best;
}

// ── Per-village themes (visual ONLY — the mask/geometry never varies) ────────
export type WfTheme = "central" | "forest" | "snow" | "volcano" | "shadow";
export type WfThemeSpec = {
    id: WfTheme;
    label: string;
    tileHue: number; tileSat: number; tileLight: number;   // HSL base of the stone path tiles
    voidColor: string;      // the chasm under the field
    fogColor: string;
    skyLight: string; groundLight: string; sunColor: string;
    breachGlow: string;     // Hollow Gate breach accent
};
export const WF_THEMES: Readonly<Record<WfTheme, WfThemeSpec>> = Object.freeze({
    central: { id: "central", label: "Ancient Valley", tileHue: 0.09, tileSat: 0.16, tileLight: 0.2, voidColor: "#0b0906", fogColor: "#13100a", skyLight: "#ffe9c4", groundLight: "#3a2f20", sunColor: "#ffd98f", breachGlow: "#6ee7b7" },
    forest: { id: "forest", label: "Verdant Reach", tileHue: 0.34, tileSat: 0.2, tileLight: 0.14, voidColor: "#081208", fogColor: "#0a140c", skyLight: "#d6ffd9", groundLight: "#1e3320", sunColor: "#f2ffd9", breachGlow: "#86efac" },
    snow: { id: "snow", label: "White Ridge", tileHue: 0.58, tileSat: 0.08, tileLight: 0.34, voidColor: "#0d1420", fogColor: "#131c2c", skyLight: "#eaf4ff", groundLight: "#3a4a63", sunColor: "#eef6ff", breachGlow: "#7dd3fc" },
    volcano: { id: "volcano", label: "Cinder Steppe", tileHue: 0.03, tileSat: 0.22, tileLight: 0.13, voidColor: "#1a0705", fogColor: "#1c0b08", skyLight: "#ffd9c2", groundLight: "#38150e", sunColor: "#ffdcc2", breachGlow: "#fb923c" },
    shadow: { id: "shadow", label: "Umbral Hollow", tileHue: 0.74, tileSat: 0.16, tileLight: 0.12, voidColor: "#0b0714", fogColor: "#100a1c", skyLight: "#d6c9ff", groundLight: "#241b3a", sunColor: "#e8dcff", breachGlow: "#c084fc" },
});

/** Resolve a character's home village to a battlefield theme. Matching is by
 * loose name inclusion so it tolerates story renames; unknown → central. */
export function wfThemeForVillage(village?: string | null): WfTheme {
    const v = String(village ?? "").toLowerCase();
    if (/leaf|forest|green|grove|verdant/.test(v)) return "forest";
    if (/snow|frost|ice|glacier|white/.test(v)) return "snow";
    if (/fire|volcano|ember|cinder|ash|lava/.test(v)) return "volcano";
    if (/shadow|umbra|night|dusk|dark/.test(v)) return "shadow";
    return "central";
}

/*
 * Village Stores — client mirror of api/_village-stores.ts + api/_village-intel.ts.
 *
 * Two server-owned stockpiles ride the village treasury: PROVISIONS (counted in
 * rations, `provisions`) and MATERIALS (counted in materials, `materialPoints`).
 * Those two names and those two units are the only ones player-facing copy may
 * use — never "craft points", "material points", "pts" or "supplies". The
 * internal identifiers keep their historical spelling on purpose: they are the
 * server's field names. The client only DISPLAYS them:
 * they are credited by /api/village/treasury/donate, drained by the daily
 * war pass and /api/village/war-structure, and the save blob may never raise
 * either figure (api/_village-state-validate.ts). Every number here is a
 * display mirror — KEEP IN SYNC with the server constants it names.
 */

export type StoresLedgerKind = "spoil" | "war" | "merc" | "garrison" | "convert" | "structure" | "feed-toggle" | "home-loss";

export interface StoresLedgerEntry {
    at: number;
    kind: StoresLedgerKind;
    amount: number;
    by?: string;
    ref?: string;
}

const LEDGER_KINDS: ReadonlySet<string> = new Set<StoresLedgerKind>(["spoil", "war", "merc", "garrison", "convert", "structure", "feed-toggle", "home-loss"]);

/** Per-player daily caps — mirrors api/_village-stores.ts. */
export const DAILY_RATION_DONATION_CAP = 40;
export const DAILY_CRAFT_POINT_DONATION_CAP = 1_500;
export const DAILY_RATION_COOK_CAP = 40;
/** Rations a fed garrison costs per day. */
export const GARRISON_RATIONS_PER_DAY = 15;
/** Rations one active sector war burns per day (mirror of WAR_RATIONS_PER_DAY
 *  in api/_village-stores.ts). Display-only: it sizes the "running short of
 *  rations" threshold, it does not decide the server's fed/unfed verdict. */
export const WAR_RATIONS_PER_DAY = 30;
/** Materials burned per War Resource at the Supply Depot. */
export const DEPOT_CONVERSION_POINTS_PER_WR = 10;
/** How many ledger rows the Town Hall shows. */
export const STORES_LEDGER_VIEW_ROWS = 10;

/** Materials debited when raising a permanent structure TO L6..L10
 *  (mirror of STRUCTURE_MATERIALS_BY_LEVEL). Levels ≤ 5 need none. */
export const STRUCTURE_MATERIALS_BY_LEVEL: Readonly<Record<number, number>> = {
    6: 400, 7: 700, 8: 1_100, 9: 1_600, 10: 2_400,
};
export function structureMaterialsCost(newLevel: number): number {
    return STRUCTURE_MATERIALS_BY_LEVEL[Math.floor(Number(newLevel) || 0)] ?? 0;
}

const nonNeg = (v: unknown) => {
    const n = Math.floor(Number(v) || 0);
    return n > 0 ? n : 0;
};

/** Read the two stores off any treasury-shaped blob (never negative). */
export function readStores(treasury: Record<string, unknown> | null | undefined): { provisions: number; materialPoints: number } {
    const t = treasury ?? {};
    return { provisions: nonNeg(t.provisions), materialPoints: nonNeg(t.materialPoints) };
}

export function parseStoresLedger(raw: unknown): StoresLedgerEntry[] {
    if (!Array.isArray(raw)) return [];
    const out: StoresLedgerEntry[] = [];
    for (const e of raw) {
        if (!e || typeof e !== "object") continue;
        const v = e as Record<string, unknown>;
        const kind = String(v.kind ?? "");
        if (!LEDGER_KINDS.has(kind)) continue;
        out.push({
            at: Math.floor(Number(v.at) || 0),
            kind: kind as StoresLedgerKind,
            amount: Math.floor(Number(v.amount) || 0),
            ...(typeof v.by === "string" && v.by ? { by: v.by } : {}),
            ...(typeof v.ref === "string" && v.ref ? { ref: v.ref } : {}),
        });
    }
    return out;
}

/** "just now" / "5m ago" / "2h ago" / "3d ago". */
export function relativeAgo(at: number, now: number = Date.now()): string {
    const diff = Math.max(0, now - (Math.floor(Number(at)) || 0));
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

const KIND_LABEL: Record<StoresLedgerKind, string> = {
    spoil: "Spoilage",
    war: "War burn",
    merc: "Merc rations",
    garrison: "Garrison feed",
    convert: "Depot conversion",
    structure: "Structure build",
    "feed-toggle": "Feed toggled",
    "home-loss": "Home sector lost",
};

/** Kinds whose amount is counted in MATERIALS rather than rations. */
const POINT_KINDS: ReadonlySet<StoresLedgerKind> = new Set<StoresLedgerKind>(["convert", "structure"]);

/** A glyph per ledger kind, so a run of "−" rows reads as a supply log rather
 *  than a column of errors. Decorative only — every row still spells its kind
 *  out in words, so the icon is never the only carrier of meaning. */
const KIND_ICON: Record<StoresLedgerKind, string> = {
    spoil: "🍂",
    war: "⚔️",
    merc: "🗡️",
    garrison: "🛡️",
    convert: "⚙️",
    structure: "🏯",
    "feed-toggle": "🍚",
    "home-loss": "🏳️",
};

export function storesLedgerIcon(kind: StoresLedgerKind): string {
    return KIND_ICON[kind] ?? "📦";
}

const STRUCTURE_NAMES: Record<string, string> = {
    ramparts: "Ramparts", watchtower: "Watchtower", barracks: "Barracks",
    warAcademy: "War Academy", supplyDepot: "Supply Depot", treasuryVault: "Treasury Vault",
};

/** Humanize a ledger `ref`: a sector-war id ("12:a-vs-b") or "sector:12" →
 *  "Sector 12"; "wr:250" → "→ 250 WR"; "barracks:6" → "Barracks L6"; else raw. */
export function formatLedgerRef(ref: string | undefined): string {
    const r = String(ref ?? "").trim();
    if (!r) return "";
    const sectorWar = /^(\d+):/.exec(r);
    if (sectorWar) return `Sector ${sectorWar[1]}`;
    const sector = /^sector:(\d+)$/.exec(r);
    if (sector) return `Sector ${sector[1]}`;
    const wr = /^wr:(\d+)$/.exec(r);
    if (wr) return `→ ${Number(wr[1]).toLocaleString()} WR`;
    const struct = /^([a-zA-Z]+):(\d+)$/.exec(r);
    if (struct && STRUCTURE_NAMES[struct[1]]) return `${STRUCTURE_NAMES[struct[1]]} L${struct[2]}`;
    return r;
}

/** One ledger row → "2h ago · War burn −30 · Sector 12". */
export function formatStoresLedgerEntry(e: StoresLedgerEntry, now: number = Date.now()): string {
    const parts = [relativeAgo(e.at, now)];
    const unit = POINT_KINDS.has(e.kind) ? " materials" : "";
    if (e.kind === "feed-toggle") parts.push(`${KIND_LABEL[e.kind]} ${e.amount > 0 ? "on" : "off"}`);
    else parts.push(`${KIND_LABEL[e.kind]} −${Math.abs(e.amount).toLocaleString()}${unit}`);
    const ref = formatLedgerRef(e.ref);
    if (ref) parts.push(ref);
    if (e.by) parts.push(`by ${e.by}`);
    return parts.join(" · ");
}

/** The last N rows, NEWEST first, ready to render. */
export function storesLedgerLines(raw: unknown, now: number = Date.now(), rows: number = STORES_LEDGER_VIEW_ROWS): string[] {
    return parseStoresLedger(raw).slice(-rows).reverse().map((e) => formatStoresLedgerEntry(e, now));
}

export type StoresLedgerRow = { key: string; kind: StoresLedgerKind; icon: string; text: string };

/** The same last-N rows with their kind and glyph kept, so the Supply Log can
 *  render an icon per row. Call it from RENDER, not from the fetch: the "5m
 *  ago" stamps are computed against `now` and go stale the moment they are
 *  baked into state. */
export function storesLedgerRows(raw: unknown, now: number = Date.now(), rows: number = STORES_LEDGER_VIEW_ROWS): StoresLedgerRow[] {
    return parseStoresLedger(raw).slice(-rows).reverse().map((e, i) => ({
        key: `${e.at}-${e.kind}-${i}`,
        kind: e.kind,
        icon: storesLedgerIcon(e.kind),
        text: formatStoresLedgerEntry(e, now),
    }));
}

// ── Donation routing (display) ──────────────────────────────────────────────

export const RATION_ITEM_ID = "ration-pack";

/** Materials credited per donatable material / relic — mirrors the
 *  api/craft/_forge.ts CRAFT_POINTS table. KEEP IN SYNC: the server is still
 *  the authority on what a donation credits; this table only lets the Town Hall
 *  say how much of the daily materials cap a donation would spend BEFORE the
 *  request, so the 1,500/day 429 is never a surprise. */
export const CRAFT_POINT_VALUES: Readonly<Record<string, number>> = {
    "hunt-torn-hide": 3, "hunt-wild-feather": 3, "hunt-small-fang": 3, "hunt-cracked-horn": 3,
    "hunt-beast-meat": 5, "hunt-frost-pelt": 8, "hunt-shadow-claw": 8, "hunt-wolf-fang": 10,
    "hunt-ash-scale": 15, "hunt-ember-scale": 20, "hunt-shadow-pelt": 25,
    "hunt-ancient-beast-core": 30, "hunt-titan-bone": 30, "hunt-legendary-material": 50,
    "weekly-boss-core": 150, "dungeon-legendary-relic": 200, "warforged-relic": 250, "veil-of-the-hollow": 250,
};

/** Which store an item donation lands in — mirrors storesDonationRouting's
 *  id rule (ration-pack → provisions; anything in CRAFT_POINT_VALUES →
 *  materials; everything else stays a loose treasury item). */
export function storesDonationBucket(itemId: string): "provisions" | "materialPoints" | null {
    const id = String(itemId ?? "");
    if (id === RATION_ITEM_ID) return "provisions";
    return (CRAFT_POINT_VALUES[id] ?? 0) > 0 ? "materialPoints" : null;
}

// ── Per-donor daily donation caps (mirror of api/_treasury-stores-donate.ts) ──
//
// Donating a CRAFT_POINT_VALUES item is capped at 1,500 materials/day and rations at
// 40/day, and the endpoint answers 429 past either. Both caps are read off the
// donor's own server-mirrored save counters, so the Town Hall can show the
// running total and refuse locally instead of surfacing a raw 429.

/** Rations and materials this player already donated today (UTC), read off
 *  the server-mirrored save counters (one shared `storesDonatedDate` stamp).
 *  The `craftPoints` key is the save's own field name — the number it carries
 *  is MATERIALS wherever it reaches a player. */
export function storesDonatedToday(character: object, now: number = Date.now()): { rations: number; craftPoints: number } {
    const c = character as Record<string, unknown>;
    const today = new Date(now).toISOString().slice(0, 10);
    if (String(c.storesDonatedDate ?? "") !== today) return { rations: 0, craftPoints: 0 };
    return { rations: nonNeg(c.rationsDonatedToday), craftPoints: nonNeg(c.craftPointsDonatedToday) };
}

/** "Donated today: 5/40 rations · 320/1,500 materials." */
export function storesDonationCapLine(character: object, now: number = Date.now()): string {
    const used = storesDonatedToday(character, now);
    return `Donated today: ${used.rations}/${DAILY_RATION_DONATION_CAP} rations · `
        + `${used.craftPoints.toLocaleString()}/${DAILY_CRAFT_POINT_DONATION_CAP.toLocaleString()} materials.`;
}

export type StoresDonationGate = { ok: true } | { ok: false; reason: string };

/** Why the Donate Item button is disabled — mirrors routeStoresDonation's cap
 *  check, in its order. Items that route nowhere are never capped. */
export function storesDonationGate(
    character: object,
    itemId: string,
    count: number = 1,
    now: number = Date.now(),
): StoresDonationGate {
    const bucket = storesDonationBucket(itemId);
    if (!bucket) return { ok: true };
    const n = Math.max(1, Math.floor(Number(count) || 1));
    const used = storesDonatedToday(character, now);
    if (bucket === "provisions") {
        return used.rations + n > DAILY_RATION_DONATION_CAP
            ? { ok: false, reason: `Daily limit: ${used.rations}/${DAILY_RATION_DONATION_CAP} rations donated today` }
            : { ok: true };
    }
    const points = (CRAFT_POINT_VALUES[String(itemId ?? "")] ?? 0) * n;
    return used.craftPoints + points > DAILY_CRAFT_POINT_DONATION_CAP
        ? { ok: false, reason: `Daily limit: ${used.craftPoints.toLocaleString()}/${DAILY_CRAFT_POINT_DONATION_CAP.toLocaleString()} materials donated today; this would add ${points.toLocaleString()}` }
        : { ok: true };
}

/** Toast suffix after a routed donation: "+5 rations" / "+40 materials". */
export function storesCreditNote(stores: { provisions?: number; materialPoints?: number } | null | undefined, before: { provisions: number; materialPoints: number }): string {
    if (!stores) return "";
    const parts: string[] = [];
    const p = Number(stores.provisions);
    const m = Number(stores.materialPoints);
    if (Number.isFinite(p) && p > before.provisions) parts.push(`+${(p - before.provisions).toLocaleString()} rations`);
    if (Number.isFinite(m) && m > before.materialPoints) parts.push(`+${(m - before.materialPoints).toLocaleString()} materials`);
    return parts.join(" / ");
}

// ── Structures (materials gate) ─────────────────────────────────────────────

export type MaterialsRequiredError = { error: "materials-required"; cost?: number; need: number; have: number };

export function isMaterialsRequired(data: unknown): data is MaterialsRequiredError {
    if (!data || typeof data !== "object") return false;
    const d = data as Record<string, unknown>;
    return d.error === "materials-required" && Number.isFinite(Number(d.need)) && Number.isFinite(Number(d.have));
}

/** "The stores are 250 materials short (150 of 400)." */
export function materialsShortMessage(need: number, have: number): string {
    const n = nonNeg(need);
    const h = nonNeg(have);
    return `The stores are ${Math.max(0, n - h).toLocaleString()} materials short (${h.toLocaleString()} of ${n.toLocaleString()}).`;
}

// ── Intel (api/_village-intel.ts mirror) ────────────────────────────────────

export type IntelTier = "none" | "scouted" | "mapped" | "infiltrated";
export const INTEL_TIER_THRESHOLDS: Readonly<Record<Exclude<IntelTier, "none">, number>> = { scouted: 100, mapped: 250, infiltrated: 500 };
/** How long a sector's intel survives its LAST credit — mirror of INTEL_TTL_MS
 *  in api/_village-intel.ts. Every credit pushes `expiresAt` out again, so a
 *  sector worked regularly never expires and an abandoned one drops back to
 *  Unscouted. Display-only: the server prunes, this only lets the copy say so. */
export const INTEL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INTEL_TTL_DAYS = INTEL_TTL_MS / 86_400_000;
/** Sector-war declare BASE cost per tier (250 → 175 / 125), before the comeback multiplier. */
export const INTEL_DECLARE_BASE_COST: Readonly<Record<IntelTier, number>> = { none: 250, scouted: 250, mapped: 175, infiltrated: 125 };

export function intelTierFor(points: number, thresholds: Readonly<Record<Exclude<IntelTier, "none">, number>> = INTEL_TIER_THRESHOLDS): IntelTier {
    const p = Math.floor(Number(points) || 0);
    if (p >= thresholds.infiltrated) return "infiltrated";
    if (p >= thresholds.mapped) return "mapped";
    if (p >= thresholds.scouted) return "scouted";
    return "none";
}

/** "Scouted · 140 pts" / "Mapped" / "Infiltrated" / "Unscouted". */
export function intelTierLabel(tier: IntelTier, points?: number): string {
    if (tier === "none") return "Unscouted";
    const name = tier === "scouted" ? "Scouted" : tier === "mapped" ? "Mapped" : "Infiltrated";
    const p = Math.floor(Number(points) || 0);
    return tier === "scouted" && p > 0 ? `${name} · ${p.toLocaleString()} pts` : name;
}

/** Comeback multiplier on a declare — mirrors api/_war-economy.ts
 *  comebackCostMultiplier (0 held = free … 4+ = full price). */
export function comebackCostMultiplier(sectorsHeld: number): number {
    const s = nonNeg(sectorsHeld);
    if (s <= 0) return 0;
    if (s === 1) return 0.25;
    if (s === 2) return 0.5;
    if (s === 3) return 0.75;
    return 1;
}

/** The WR a declare is expected to cost: intel-discounted base × comeback. */
export function expectedDeclareCost(tier: IntelTier, sectorsHeld: number): number {
    const base = INTEL_DECLARE_BASE_COST[tier] ?? INTEL_DECLARE_BASE_COST.none;
    return Math.round(base * comebackCostMultiplier(sectorsHeld));
}

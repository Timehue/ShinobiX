/*
 * Village Intel — client cache + poller for the per-viewer intel block.
 *
 * It comes from its OWN authenticated endpoint (GET /api/village/intel), not
 * from the world-state poll. Intel is per-viewer, so inlining it in the shared
 * world-state document forced that response to `private, no-store`; because
 * authFetch patches window.fetch for every /api/ URL, every signed-in player's
 * 15s world poll was authenticated and therefore uncacheable, turning roughly
 * one origin request per 12s into one per player per 15s. Intel is slow-moving
 * (a sector's tier changes after ~100 explores), so it polls on its own lazy
 * cadence instead: every POLL_INTERVAL_MS in the background, and on demand
 * (throttled) whenever the world map actually asks for a sector's plate.
 *
 * Shape mirrors api/_village-intel.ts VillageIntelView.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isWildSector } from "../../../shared/sector-geo";
import { getSocketAuth } from "../authFetch";
import { INTEL_TIER_THRESHOLDS, intelTierFor, intelTierLabel, type IntelTier } from "./village-stores";
import { intelPayoffLines } from "./village-stores-signposts";
import { sectorPoolViewFor } from "./sector-pool";
import { loadSectorTerritory, notifySharedWorldStateLateChange, subscribeSharedWorldStateLateChanges } from "./world-state";

export type IntelGarrisonState = "none" | "locked" | "open";
export type IntelStructureKey = "ramparts" | "watchtower" | "barracks" | "warAcademy" | "supplyDepot" | "treasuryVault";

export type RevealedSectorIntel = {
    sector: number;
    points: number;
    tier: IntelTier;
    expiresAt: number;
    owner: string | null;
    revealed: {
        garrison: IntelGarrisonState;
        poolUsage: { explores: number; chests: number };
        structures: Record<IntelStructureKey, number> | null;
    };
};
export type ScoutedBy = { village: string; tier: IntelTier; points: number };
export type VillageIntelView = {
    village: string;
    thresholds: { scouted: number; mapped: number; infiltrated: number };
    revealed: RevealedSectorIntel[];
    scoutedBy: Record<string, ScoutedBy[]>;
};

const STRUCTURE_KEYS: readonly IntelStructureKey[] = ["ramparts", "watchtower", "barracks", "warAcademy", "supplyDepot", "treasuryVault"];
const TIERS: ReadonlySet<string> = new Set<IntelTier>(["none", "scouted", "mapped", "infiltrated"]);
const count = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

let intelCache: VillageIntelView | null = null;
let lastSnapshot = "";
/** A request has actually gone out (never true for a logged-out viewer). */
let intelRequested = false;
/** The server has answered at least once — a still-null cache now means "no intel", not "not yet". */
let intelSettled = false;
/**
 * Bumped whenever anything the plate projection reads changed (the cache, or
 * the requested/settled flags that pick between the loading shell and null).
 * `useSectorIntelPlate` memoizes on it, so the projection can stay pure while
 * still refreshing the moment a poll lands.
 */
let intelRevision = 0;
export function villageIntelRevision(): number { return intelRevision; }
/** Bump the revision AND wake the shared late-change bus (the App subscribes to
 *  it and re-renders, which is what lets the memo above recompute). */
function markVillageIntelChanged(): void {
    intelRevision += 1;
    notifySharedWorldStateLateChange();
}

function cleanTier(v: unknown, points: number, thresholds: VillageIntelView["thresholds"]): IntelTier {
    return typeof v === "string" && TIERS.has(v) ? (v as IntelTier) : intelTierFor(points, thresholds);
}

export function cleanVillageIntel(raw: unknown): VillageIntelView | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const village = String(r.village ?? "").trim();
    if (!village) return null;
    const th = r.thresholds && typeof r.thresholds === "object" ? r.thresholds as Record<string, unknown> : {};
    const thresholds = {
        scouted: count(th.scouted) || INTEL_TIER_THRESHOLDS.scouted,
        mapped: count(th.mapped) || INTEL_TIER_THRESHOLDS.mapped,
        infiltrated: count(th.infiltrated) || INTEL_TIER_THRESHOLDS.infiltrated,
    };
    const revealed: RevealedSectorIntel[] = [];
    for (const e of Array.isArray(r.revealed) ? r.revealed : []) {
        if (!e || typeof e !== "object") continue;
        const v = e as Record<string, unknown>;
        const sector = count(v.sector);
        if (sector < 1) continue;
        const points = count(v.points);
        const rv = v.revealed && typeof v.revealed === "object" ? v.revealed as Record<string, unknown> : {};
        const pool = rv.poolUsage && typeof rv.poolUsage === "object" ? rv.poolUsage as Record<string, unknown> : {};
        const rawStructures = rv.structures && typeof rv.structures === "object" ? rv.structures as Record<string, unknown> : null;
        const structures = rawStructures
            ? STRUCTURE_KEYS.reduce((acc, k) => { acc[k] = count(rawStructures[k]); return acc; }, {} as Record<IntelStructureKey, number>)
            : null;
        const garrison = rv.garrison === "locked" || rv.garrison === "open" ? rv.garrison : "none";
        revealed.push({
            sector,
            points,
            tier: cleanTier(v.tier, points, thresholds),
            expiresAt: count(v.expiresAt),
            owner: typeof v.owner === "string" && v.owner ? v.owner : null,
            revealed: { garrison, poolUsage: { explores: count(pool.explores), chests: count(pool.chests) }, structures },
        });
    }
    const scoutedBy: Record<string, ScoutedBy[]> = {};
    const sb = r.scoutedBy && typeof r.scoutedBy === "object" ? r.scoutedBy as Record<string, unknown> : {};
    for (const [key, list] of Object.entries(sb)) {
        const sector = count(key);
        if (sector < 1 || !Array.isArray(list)) continue;
        const rows: ScoutedBy[] = [];
        for (const s of list) {
            if (!s || typeof s !== "object") continue;
            const row = s as Record<string, unknown>;
            const name = String(row.village ?? "").trim();
            if (!name) continue;
            const points = count(row.points);
            rows.push({ village: name, points, tier: cleanTier(row.tier, points, thresholds) });
        }
        if (rows.length) scoutedBy[String(sector)] = rows;
    }
    return { village, thresholds, revealed, scoutedBy };
}

/** Apply a /api/village/intel response. Returns true when the cache changed. A
 *  payload WITHOUT the block (kill switch off, admin, or no village) clears the
 *  cache — nothing should stay revealed once the server stops revealing it. */
export function hydrateVillageIntel(data: { villageIntel?: unknown } | null | undefined): boolean {
    intelSettled = true;
    intelCache = cleanVillageIntel(data?.villageIntel);
    const snapshot = intelCache ? JSON.stringify(intelCache) : "";
    const changed = snapshot !== lastSnapshot;
    lastSnapshot = snapshot;
    if (changed) intelRevision += 1;
    return changed;
}

export function loadVillageIntel(): VillageIntelView | null {
    return intelCache;
}

// ── Poll (GET /api/village/intel, through the authFetch interceptor) ─────────

export const VILLAGE_INTEL_API = "/api/village/intel";
/** Background cadence, driven by the world-state poll's nudge. */
export const POLL_INTERVAL_MS = 45_000;
/** Floor for on-demand refreshes (world map opened / selected sector changed). */
export const ON_DEMAND_MIN_MS = 10_000;

let lastFetchAt = 0;
let inFlight: Promise<void> | null = null;
/** The signed-in player the cache belongs to. "" = logged out. */
let cachedForPlayer = "";

function activePlayer(): string {
    try {
        return String(getSocketAuth().name ?? "").trim();
    } catch {
        return "";
    }
}

/** Drop everything (logout / account switch). Returns true when it changed. */
export function clearVillageIntel(): boolean {
    const wasPending = intelRequested || intelSettled;
    cachedForPlayer = "";
    lastFetchAt = 0;
    intelRequested = false;
    intelSettled = false;
    const changed = lastSnapshot !== "";
    intelCache = null;
    lastSnapshot = "";
    if (changed || wasPending) intelRevision += 1;
    return changed;
}

async function fetchVillageIntel(minAgeMs: number): Promise<void> {
    const player = activePlayer();
    // Logged out: never call the endpoint (it is 401-only anyway) and make sure
    // the previous viewer's reveals do not linger on screen.
    if (!player) {
        if (clearVillageIntel()) markVillageIntelChanged();
        return;
    }
    // Account switch: the cached block belongs to somebody else. Wipe it and
    // refetch immediately rather than waiting out the throttle.
    if (player !== cachedForPlayer) {
        clearVillageIntel();
        cachedForPlayer = player;
        minAgeMs = 0;
    }
    if (inFlight) return inFlight;
    if (minAgeMs > 0 && Date.now() - lastFetchAt < minAgeMs) return;
    lastFetchAt = Date.now();
    // The very first request is what turns the plate into its loading shell, so
    // the projection's inputs just changed even though nothing has landed yet.
    const firstRequest = !intelRequested;
    intelRequested = true;
    if (firstRequest) intelRevision += 1;
    inFlight = (async () => {
        try {
            // authFetch attaches x-player-name / x-player-token for /api/ URLs.
            const response = await fetch(VILLAGE_INTEL_API, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
            // The server answered, so a still-empty cache is now an answer too
            // (401 / kill switch / no village) rather than a pending request.
            // That flip retires the loading shell, so it is a visible change in
            // its own right even when the (empty) cache did not move.
            const settling = !intelSettled;
            intelSettled = true;
            if (!response.ok) {
                if (settling) markVillageIntelChanged();
                return;
            }
            const data = await response.json() as { villageIntel?: unknown };
            // The viewer may have logged out or switched mid-flight.
            if (activePlayer() !== player) return;
            if (hydrateVillageIntel(data) || settling) markVillageIntelChanged();
        } catch {
            /* transient — the next nudge retries */
        } finally {
            inFlight = null;
        }
    })();
    return inFlight;
}

/** Background cadence hook, called by the world-state poll (lib/world-state). */
export function maybeRefreshVillageIntel(): void {
    void fetchVillageIntel(POLL_INTERVAL_MS);
}

/** On-demand hook: the world map is showing a sector plate. Throttled. */
export function requestVillageIntelRefresh(): void {
    void fetchVillageIntel(ON_DEMAND_MIN_MS);
}

export function revealedIntelForSector(sector: number): RevealedSectorIntel | null {
    return intelCache?.revealed.find((r) => r.sector === sector) ?? null;
}

// ── Selected-sector plate projection ────────────────────────────────────────

export type SectorIntelPlateView = {
    /** True while the first /api/village/intel response is still outstanding. */
    loading: boolean;
    /** "Scouted · 140 pts" / "Mapped" / "Infiltrated" / "Unscouted". */
    tierLabel: string;
    tier: IntelTier;
    /**
     * Status-pill modifier for the tier. The tier IS the point of this card, so
     * it cannot render the same green pill at every tier: neutral unscouted,
     * gold once scouted, red once mapped or infiltrated (somebody knows enough
     * to move on the sector). Classes live in styles/index/15-territory-panels.css.
     */
    tierPillClass: string;
    /** "Intel goes cold in 2d" — null when nothing is revealed or no expiry is known. */
    expiryLabel: string | null;
    /** Reveal block — only for tiers ≥ scouted. */
    reveal: {
        garrison: IntelGarrisonState;
        garrisonLabel: string;
        /** The garrison line is an alarm, not a status: this sector can be hit now. */
        garrisonAlert: boolean;
        poolLine: string;
        /** RAISED structures only (level > 0); `[]` = owner village has raised none. */
        structures: Array<{ key: IntelStructureKey; name: string; level: number }> | null;
        /** "Ramparts L2, Supply Depot L4" / "No structures raised here." / null when unowned. */
        structuresLabel: string | null;
    } | null;
    /** What exploring here would buy, as two sentences — only when nothing is revealed. */
    unscoutedNotes: string[];
    /**
     * What the intel this sector already carries BOUGHT, addressed to the player
     * who earned it — the reveal at Scouted, the declare saving in WR at Mapped
     * and Infiltrated, and what the next tier would add. Empty at "none" (the
     * unscouted notes cover that) and while loading.
     *
     * The explorer grinds the intel and the Kage spends it, so the saving is
     * named as the Kage's. Nothing here re-permissions the declare.
     */
    payoffLines: string[];
    /** "<Village> has mapped this sector." lines — only for sectors the viewer's village OWNS. */
    scoutedByLines: string[];
};

const STRUCTURE_NAMES: Record<IntelStructureKey, string> = {
    ramparts: "Ramparts", watchtower: "Watchtower", barracks: "Barracks",
    warAcademy: "War Academy", supplyDepot: "Supply Depot", treasuryVault: "Treasury Vault",
};
const GARRISON_LABEL: Record<IntelGarrisonState, string> = {
    none: "No siege",
    locked: "Locked — defenders still turning up",
    open: "Open to assault",
};
/** Neutral / gold / red. See SectorIntelPlateView.tierPillClass. */
const TIER_PILL_CLASS: Record<IntelTier, string> = {
    none: "",
    scouted: "is-traveling",
    mapped: "is-fighting",
    infiltrated: "is-fighting",
};
/** Whole sentences, not a raw enum in a parenthetical — an enemy who has
 *  infiltrated a sector you own is the loudest signal this card can carry. */
const SCOUTED_BY_PHRASE: Record<IntelTier, string> = {
    none: "has been probing this sector.",
    scouted: "has scouted this sector.",
    mapped: "has mapped this sector.",
    infiltrated: "has infiltrated this sector — they know your garrison and your structures.",
};

/** "Intel goes cold in 2d" / "… in 5h" / "… in under an hour". */
export function intelExpiryLabel(expiresAt: number, now: number = Date.now()): string | null {
    const left = Math.floor(Number(expiresAt) || 0) - now;
    if (!Number.isFinite(left) || left <= 0) return null;
    const hours = left / 3_600_000;
    if (hours < 1) return "Intel goes cold in under an hour";
    if (hours < 24) return `Intel goes cold in ${Math.floor(hours)}h`;
    return `Intel goes cold in ${Math.floor(hours / 24)}d`;
}

/** Build the plate view for `sector` as seen by `viewerVillage`. `caps` are the
 *  shared pool caps (lib/sector-pool) so usage reads "N / M". Returns null when
 *  no intel block was hydrated (logged-out, feature off, or no village). */
export function intelPlateViewFor(
    sector: number,
    viewerVillage: string | undefined,
    ownerVillage: string | undefined,
    caps: { explores: number; chests: number },
    intel: VillageIntelView | null = intelCache,
    now: number = Date.now(),
): SectorIntelPlateView | null {
    if (!intel || !viewerVillage || intel.village !== viewerVillage) return null;
    const rev = intel.revealed.find((r) => r.sector === sector) ?? null;
    const tier: IntelTier = rev?.tier ?? "none";
    // Six structures at L0 is a wall of nothing that reads as a bug; show what
    // the owner actually raised, and say so plainly when they raised nothing.
    const raised = rev?.revealed.structures
        ? STRUCTURE_KEYS
            .map((key) => ({ key, name: STRUCTURE_NAMES[key], level: rev.revealed.structures?.[key] ?? 0 }))
            .filter((s) => s.level > 0)
        : null;
    const reveal = rev && tier !== "none"
        ? {
            garrison: rev.revealed.garrison,
            garrisonLabel: GARRISON_LABEL[rev.revealed.garrison],
            garrisonAlert: rev.revealed.garrison === "open",
            poolLine: `Explores ${rev.revealed.poolUsage.explores.toLocaleString()} / ${caps.explores.toLocaleString()} · Chests ${rev.revealed.poolUsage.chests.toLocaleString()} / ${caps.chests.toLocaleString()}`,
            structures: raised,
            structuresLabel: raised
                ? (raised.length ? raised.map((s) => `${s.name} L${s.level}`).join(", ") : "No structures raised here.")
                : null,
        }
        : null;
    const owned = !!ownerVillage && ownerVillage === viewerVillage;
    const scoutedByLines = owned
        ? (intel.scoutedBy[String(sector)] ?? []).map((s) => `${s.village} ${SCOUTED_BY_PHRASE[s.tier]}`)
        : [];
    return {
        loading: false,
        tierLabel: intelTierLabel(tier, rev?.points),
        tier,
        tierPillClass: TIER_PILL_CLASS[tier],
        expiryLabel: reveal && rev ? intelExpiryLabel(rev.expiresAt, now) : null,
        reveal,
        unscoutedNotes: reveal ? [] : [
            "No one from your village has scouted here. Explore and open chests to build intel.",
            `${intel.thresholds.scouted.toLocaleString()} intel reveals the garrison and structures. ${intel.thresholds.mapped.toLocaleString()} makes a sector-war declare cheaper.`,
        ],
        // Derived entirely from the tier and the server-sent thresholds already
        // on this payload — no extra request, no extra field.
        payoffLines: intelPayoffLines(tier, intel.thresholds),
        scoutedByLines,
    };
}

/** Card shell while the first fetch is in flight — the panel must not pop. */
const LOADING_PLATE: SectorIntelPlateView = {
    loading: true, tierLabel: "Checking…", tier: "none", tierPillClass: "",
    expiryLabel: null, reveal: null, unscoutedNotes: [], payoffLines: [], scoutedByLines: [],
};

/**
 * PURE projection — it reads the cache and nothing else.
 *
 * It used to kick `requestVillageIntelRefresh()` off before the null check, so
 * that a cold cache still got its first fetch. But WorldMap calls this inline
 * in JSX, which made every render issue a network request (four synchronous
 * storage reads apiece, ahead of the throttle) and closed a loop: render →
 * fetch → late-change bus → App setState → render. The whole App re-rendered on
 * the 10s on-demand floor instead of the intended 45s background cadence. The
 * refresh now lives in `useSectorIntelPlate`'s effect.
 */
export function sectorIntelPlateForViewer(sector: number, viewerVillage: string | undefined, ownerVillage: string | undefined): SectorIntelPlateView | null {
    // A cold cache is two different things: a request still in flight (render
    // the shell, so the panel does not reflow a second later) and a settled
    // "no intel for you" — kill switch off, no village, or an admin (render
    // nothing). `intelRequested` also keeps the shell off a logged-out viewer's
    // screen, since they never issue the request at all.
    if (!intelCache) return intelRequested && !intelSettled ? LOADING_PLATE : null;
    const pool = sectorPoolViewFor(sector, ownerVillage, viewerVillage);
    return intelPlateViewFor(sector, viewerVillage, ownerVillage, { explores: pool.exploresCap, chests: pool.chestsCap });
}

/**
 * The effect body of `useSectorIntelPlate`, exported so the rule can be tested
 * without a DOM. Only a signed-in viewer looking at a WILD sector's plate asks
 * for a top-up; the fetch itself is still floored at ON_DEMAND_MIN_MS. Returns
 * whether it asked.
 */
export function refreshIntelForSelectedSector(sector: number | null, viewerVillage: string | undefined): boolean {
    if (!viewerVillage || sector == null || !isWildSector(sector)) return false;
    const cold = !intelRequested;
    requestVillageIntelRefresh();
    // The first request is what turns the plate into its loading shell, and the
    // effect runs AFTER the render that returned null — so without this nudge
    // nothing would repaint the panel until the response landed, and the card
    // would pop in exactly the way the shell exists to prevent.
    if (cold && intelRequested) markVillageIntelChanged();
    return true;
}

/**
 * The World Map's selected-sector plate: the pure projection above, memoized,
 * with the on-demand refresh moved into an EFFECT.
 *
 * The effect fires when the map opens on a wild sector and whenever the
 * selection (or the viewer) changes — still floored at ON_DEMAND_MIN_MS, while
 * the background nudge keeps its own POLL_INTERVAL_MS cadence. Re-rendering is
 * driven by the late-change bus (which only Village Intel writes to), so an
 * unchanged poll now re-renders nothing at all.
 */
export function useSectorIntelPlate(sector: number | null, viewerVillage: string | undefined): SectorIntelPlateView | null {
    const revision = useSyncExternalStore(subscribeSharedWorldStateLateChanges, villageIntelRevision, villageIntelRevision);
    useEffect(() => { refreshIntelForSelectedSector(sector, viewerVillage); }, [sector, viewerVillage]);
    // Ownership only sizes the pool caps inside the reveal line. Reading it here
    // is a cache lookup, not I/O, and it keeps the memo's dependencies honest.
    const wild = sector != null && isWildSector(sector);
    const ownerVillage = wild && sector != null ? loadSectorTerritory(sector).ownerVillage : undefined;
    return useMemo(() => {
        // The projection reads module state, so the revision is what tells the
        // memo the cache moved. Referenced deliberately, not an unused dep.
        void revision;
        return wild && sector != null ? sectorIntelPlateForViewer(sector, viewerVillage, ownerVillage) : null;
    }, [wild, sector, viewerVillage, ownerVillage, revision]);
}

/** Test hook. */
export function __resetVillageIntelCache(): void {
    intelRevision += 1;
    intelCache = null;
    lastSnapshot = "";
    cachedForPlayer = "";
    lastFetchAt = 0;
    inFlight = null;
    intelRequested = false;
    intelSettled = false;
}

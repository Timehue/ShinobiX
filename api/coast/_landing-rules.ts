import type { HallStyle } from "../../shared/coast-hall-style.js";
/*
 * The Clan Landing: a clan's base on the sector it holds. Pure rules.
 *
 * A Landing stands on one sector for one landing epoch. It is fully losable
 * (owner ruling, 2026-11-18): when the clan loses the sector the Landing is
 * destroyed, and it must be founded again on whatever ground the clan takes
 * next. Nothing is carried to the clan that took the land.
 *
 * It is one structure raised in tiers, as the art paints it: a staked plot,
 * the Founding Camp, the Landing Hall, the Defended Landing. Members pool
 * materials into its stores, an officer raises it when the stores cover the
 * next tier, and it draws upkeep from the same stores each week.
 *
 * No KV, auth or locks here, so the save-debit saga (api/_save-debit-kinds.ts)
 * and the admin reconciler can apply the exact same credit.
 *
 * The numbers were settled 2026-11-20 (the owner asked for them to be decided
 * for the game and its players):
 *   - The Founding Camp takes only the three common gathering materials, so
 *     any clan that holds ground can raise it within days.
 *   - The taller tiers also take the coast's own materials, from the sites The
 *     Boatwright's Tools leaves open for good (shared/quest-sites.ts `keptBy`).
 *     That is what the plan gave those sites for, and it makes a member who
 *     did that work worth having. The Landing Hall takes what the first quest
 *     opens (level 75) and the Defended Landing what the second opens (level
 *     80), so Raise the Clan Gate II and III never wait on a region their own
 *     level gate cannot reach.
 *   - Upkeep is paid in common materials only. The coast's materials are slow
 *     to gather and are saved for the next tier; a week's upkeep never eats them.
 *   - With five members at the weekly cap, the Landing Hall is a little over a
 *     week's work and the Defended Landing a little over two more. A Landing
 *     is fully losable, so it is not priced as months of saving.
 */

const DAY = 24 * 60 * 60_000;

/** What upkeep is paid in, and what every tier takes. */
export const COAST_LANDING_COMMON_MATERIALS = ['gather-field-herb', 'gather-binding-fiber', 'gather-iron-sand'] as const;
/** Everything a member may put into the stores: the common three, then the coast's own. */
export const COAST_LANDING_MATERIALS = [
    ...COAST_LANDING_COMMON_MATERIALS,
    'quest-wrack-cord', 'quest-splitstone-fittings', 'quest-pitchwood', 'quest-caulk-eel',
] as const;
export type CoastLandingMaterial = typeof COAST_LANDING_MATERIALS[number];

export interface CoastLandingTier {
    tier: number;
    name: string;
    /** Units of each named material it costs to raise the Landing TO this tier. */
    cost: Readonly<Partial<Record<CoastLandingMaterial, number>>>;
    /** Units of common materials, of any kind, it draws from the stores each week. */
    upkeep: number;
}

const common = (units: number) => Object.fromEntries(COAST_LANDING_COMMON_MATERIALS.map(itemId => [itemId, units])) as Partial<Record<CoastLandingMaterial, number>>;

/** Tier 0 is the plot staked and nothing built. The names are the art's. */
export const COAST_LANDING_TIERS: readonly CoastLandingTier[] = [
    { tier: 0, name: 'Staked Plot', cost: {}, upkeep: 0 },
    { tier: 1, name: 'Founding Camp', cost: common(20), upkeep: 6 },
    { tier: 2, name: 'Landing Hall', cost: { ...common(60), 'quest-wrack-cord': 20, 'quest-splitstone-fittings': 20 }, upkeep: 15 },
    { tier: 3, name: 'Defended Landing', cost: { ...common(120), 'quest-pitchwood': 30, 'quest-caulk-eel': 30 }, upkeep: 30 },
];
export const COAST_LANDING_MAX_TIER = COAST_LANDING_TIERS.length - 1;

export const COAST_LANDING = {
    /** Units one member may put into the stores in a week. */
    memberWeeklyCap: 40,
    /** Most units one contribution may carry. */
    perContribution: 20,
    /** No upkeep is asked while a Landing is this new. */
    graceMs: 7 * DAY,
    /** Unpaid weeks in a row after which the sector goes back to the Unmoored. */
    dormantWeeksToFall: 2,
} as const;

/**
 * Works: what a clan can build on its Landing besides raising it.
 *
 * Each is opened by one of the Raise the Clan Gate quests, which is what the
 * plan gave those quests to open. A work is built once, by an officer who has
 * finished that quest, from the Landing's own stores. It gives utility only:
 * nothing here touches a fight. Works stand on the Landing, so they fall with
 * it; the quest stays finished, so they can be built again on the next one.
 *
 * Settled 2026-11-20 with the rest of the Landing's numbers. Each costs less
 * than the tier it needs, so a clan chooses between a work now and the next
 * tier sooner, and none is a second wall to climb.
 */
export type CoastLandingWorkId = 'store-shed' | 'drying-racks' | 'watch-fire';

export interface CoastLandingWork {
    id: CoastLandingWorkId;
    name: string;
    /** What it does, as the player is told. */
    does: string;
    /** The quest an officer must have finished to build it, and that quest's name. */
    quest: string;
    questTitle: string;
    /** The Landing must stand at least this tall. */
    minTier: number;
    cost: Readonly<Partial<Record<CoastLandingMaterial, number>>>;
}

export const COAST_LANDING_WORK_EFFECTS = {
    /** Store Shed: units added to what one member may give in a week. */
    storeShedCap: 20,
    /** Drying Racks: the share of weekly upkeep still paid, in percent. */
    dryingRacksUpkeepPct: 75,
    /** Watch Fire: added to the notice before a contest on the Landing's sector opens. */
    watchFireNoticeMs: 12 * 60 * 60_000,
} as const;

export const COAST_LANDING_WORKS: readonly CoastLandingWork[] = [
    { id: 'store-shed', name: 'Store Shed', does: 'Each member may give 60 units a week, not 40.',
        quest: 'clan-gate-1', questTitle: 'Raise the Clan Gate I', minTier: 1, cost: common(15) },
    { id: 'drying-racks', name: 'Drying Racks', does: 'Weekly upkeep is a quarter less.',
        quest: 'clan-gate-2', questTitle: 'Raise the Clan Gate II', minTier: 2, cost: { ...common(25), 'quest-wrack-cord': 10 } },
    { id: 'watch-fire', name: 'Watch Fire', does: 'A contest declared on this ground opens 12 hours later.',
        quest: 'clan-gate-3', questTitle: 'Raise the Clan Gate III', minTier: 3, cost: { ...common(30), 'quest-pitchwood': 15 } },
];

export type CoastLandingStatus = 'active' | 'dormant' | 'destroyed';

export interface CoastLanding {
    hallStyle?: HallStyle;
    clan: string;
    clanSlug: string;
    generation: string;
    sector: number;
    /** The claim epoch this Landing stands on. A contribution made for another epoch is burned. */
    landingEpoch: number;
    status: CoastLandingStatus;
    tier: number;
    stores: Record<string, number>;
    /** Works built on this Landing (COAST_LANDING_WORKS ids). A new Landing starts with none. */
    works?: string[];
    foundedAt: number;
    foundedBy: string;
    /** The last week upkeep was settled for, paid or not. */
    upkeepWeek: number;
    dormantWeeks: number;
    /** Who gave what, by week then member. The current and the previous week are kept. */
    contributions: Record<string, Record<string, number>>;
    destroyedAt?: number;
    destroyedReason?: string;
    /** On a destroyed row only: what stood when it fell, so an admin can put back one lost to a fault. */
    lost?: { tier: number; stores: Record<string, number>; works: string[] };
    /** Written by the save-debit saga; kept across a refounding so an old receipt still answers. */
    settlementReceipts?: unknown[];
}

export interface CoastLandingContribution {
    name: string;
    itemId: string;
    count: number;
    week: number;
    landingEpoch: number;
}

const whole = (value: unknown) => Math.max(0, Math.floor(Number(value) || 0));

/** Weeks since a Monday, 00:00 UTC. The Unix epoch began on a Thursday. */
export function coastWeek(now: number): number {
    return Math.floor((now + 3 * DAY) / (7 * DAY));
}

export function isCoastLandingMaterial(itemId: unknown): itemId is CoastLandingMaterial {
    return COAST_LANDING_MATERIALS.includes(itemId as CoastLandingMaterial);
}

export function coastLandingTier(tier: number): CoastLandingTier {
    return COAST_LANDING_TIERS[Math.max(0, Math.min(COAST_LANDING_MAX_TIER, whole(tier)))];
}

export function coastLandingWork(id: unknown): CoastLandingWork | undefined {
    return COAST_LANDING_WORKS.find(work => work.id === id);
}

/** True when a standing Landing has this work built. */
export function coastLandingHasWork(landing: Pick<CoastLanding, 'status' | 'works'> | null | undefined, id: CoastLandingWorkId): boolean {
    return !!landing && landing.status !== 'destroyed' && (landing.works ?? []).includes(id);
}

/** Units one member may give this Landing in a week. */
export function coastLandingMemberCap(landing: Pick<CoastLanding, 'status' | 'works'> | null | undefined): number {
    return COAST_LANDING.memberWeeklyCap + (coastLandingHasWork(landing, 'store-shed') ? COAST_LANDING_WORK_EFFECTS.storeShedCap : 0);
}

/** Units of common materials this Landing pays each week. Rounded up, so the racks never take more than a quarter off. */
export function coastLandingUpkeep(landing: Pick<CoastLanding, 'status' | 'works' | 'tier'>): number {
    const due = coastLandingTier(landing.tier).upkeep;
    return coastLandingHasWork(landing, 'drying-racks') ? Math.ceil(due * COAST_LANDING_WORK_EFFECTS.dryingRacksUpkeepPct / 100) : due;
}

/** How much later a contest on this Landing's sector opens. Only a lit fire warns: a dormant Landing's is out. */
export function coastLandingExtraNoticeMs(landing: Pick<CoastLanding, 'status' | 'works'> | null | undefined): number {
    return landing?.status === 'active' && coastLandingHasWork(landing, 'watch-fire') ? COAST_LANDING_WORK_EFFECTS.watchFireNoticeMs : 0;
}

/** What the stores still lack for a work, by material. Empty when they cover it. */
export function coastLandingWorkShortfall(landing: CoastLanding, work: CoastLandingWork): Partial<Record<CoastLandingMaterial, number>> {
    const lacking: Partial<Record<CoastLandingMaterial, number>> = {};
    for (const [itemId, units] of Object.entries(work.cost) as Array<[CoastLandingMaterial, number]>) {
        const short = units - whole(landing.stores?.[itemId]);
        if (short > 0) lacking[itemId] = short;
    }
    return lacking;
}

/**
 * Why a work cannot be built on this Landing right now, as a word, or null when
 * it can. Who is building it, and whether they finished its quest, is the
 * caller's to check: this is only about the Landing.
 */
export function coastLandingWorkBlock(landing: CoastLanding, work: CoastLandingWork): 'fallen' | 'dormant' | 'built' | 'tier' | 'stores' | null {
    if (landing.status === 'destroyed') return 'fallen';
    if (landing.status === 'dormant') return 'dormant';
    if ((landing.works ?? []).includes(work.id)) return 'built';
    if (landing.tier < work.minTier) return 'tier';
    return Object.keys(coastLandingWorkShortfall(landing, work)).length ? 'stores' : null;
}

/** The Landing with a work built and its cost taken from the stores. Check coastLandingWorkBlock first. */
export function buildCoastLandingWork(landing: CoastLanding, work: CoastLandingWork): CoastLanding {
    const stores = { ...landing.stores };
    for (const [itemId, units] of Object.entries(work.cost)) stores[itemId] = whole(stores[itemId]) - units;
    return { ...landing, stores, works: [...(landing.works ?? []), work.id] };
}

/** What a member has put in this week. */
export function coastLandingMemberUse(landing: CoastLanding, member: string, week: number): number {
    return whole(landing.contributions?.[String(week)]?.[member]);
}

/**
 * Apply one recorded contribution to the Landing as it stands NOW. It can run
 * long after the debit (a retry, or an admin finishing a settlement), so it
 * re-checks nothing the debit decided. If the Landing it was given to has since
 * fallen, or stands on another epoch, the materials are burned: the Landing is
 * returned unchanged and the saga still records its receipt, so the same
 * request can never be applied to a later Landing.
 */
export function applyCoastLandingContribution(landing: CoastLanding, plan: CoastLandingContribution): CoastLanding {
    if (landing.status === 'destroyed' || landing.landingEpoch !== plan.landingEpoch) return landing;
    const week = String(plan.week);
    const kept = Object.fromEntries(Object.entries(landing.contributions ?? {}).filter(([key]) => Number(key) >= plan.week - 1));
    return {
        ...landing,
        stores: { ...landing.stores, [plan.itemId]: whole(landing.stores?.[plan.itemId]) + plan.count },
        contributions: { ...kept, [week]: { ...(kept[week] ?? {}), [plan.name]: whole(kept[week]?.[plan.name]) + plan.count } },
    };
}

/** What the next tier still lacks, by material. Empty when the stores cover it. */
export function coastLandingShortfall(landing: CoastLanding): Partial<Record<CoastLandingMaterial, number>> {
    if (landing.tier >= COAST_LANDING_MAX_TIER) return {};
    const lacking: Partial<Record<CoastLandingMaterial, number>> = {};
    for (const [itemId, units] of Object.entries(coastLandingTier(landing.tier + 1).cost) as Array<[CoastLandingMaterial, number]>) {
        const short = units - whole(landing.stores?.[itemId]);
        if (short > 0) lacking[itemId] = short;
    }
    return lacking;
}

/** True when the stores hold enough of every material the next tier takes. */
export function canRaiseCoastLanding(landing: CoastLanding): boolean {
    if (landing.status !== 'active' || landing.tier >= COAST_LANDING_MAX_TIER) return false;
    return Object.keys(coastLandingShortfall(landing)).length === 0;
}

export function raiseCoastLandingTier(landing: CoastLanding): CoastLanding {
    const stores = { ...landing.stores };
    for (const [itemId, units] of Object.entries(coastLandingTier(landing.tier + 1).cost)) stores[itemId] = whole(stores[itemId]) - units;
    return { ...landing, tier: landing.tier + 1, stores };
}

/**
 * Settle one week's upkeep. The stores pay it in the common materials they
 * hold, taking from the fullest first so no single material is drained. The
 * coast's own materials are never spent on upkeep. A Landing
 * that cannot pay goes dormant; one that pays wakes. `fell` is true when it has
 * now gone unpaid for too many weeks in a row.
 */
export function settleCoastLandingUpkeep(landing: CoastLanding, week: number, now: number): { landing: CoastLanding; fell: boolean } {
    if (landing.status === 'destroyed') return { landing, fell: false };
    const settledThisWeek = landing.upkeepWeek >= week;
    // A week already settled is left alone, except that a dormant Landing whose
    // members have since stocked it pays its missed upkeep late and wakes at once.
    if (settledThisWeek && landing.status !== 'dormant') return { landing, fell: false };
    if (!settledThisWeek && now - landing.foundedAt < COAST_LANDING.graceMs) return { landing: { ...landing, upkeepWeek: week }, fell: false };
    const due = coastLandingUpkeep(landing);
    const stores = { ...landing.stores };
    const held = COAST_LANDING_COMMON_MATERIALS.reduce((sum, itemId) => sum + whole(stores[itemId]), 0);
    if (held >= due) {
        for (let left = due; left > 0; left--) {
            const fullest = [...COAST_LANDING_COMMON_MATERIALS].sort((a, b) => whole(stores[b]) - whole(stores[a]))[0];
            stores[fullest] = whole(stores[fullest]) - 1;
        }
        return { landing: { ...landing, stores, upkeepWeek: week, dormantWeeks: 0, status: 'active' }, fell: false };
    }
    if (settledThisWeek) return { landing, fell: false }; // still dormant, and this week is already counted
    const dormantWeeks = landing.dormantWeeks + 1;
    return { landing: { ...landing, upkeepWeek: week, dormantWeeks, status: 'dormant' }, fell: dormantWeeks >= COAST_LANDING.dormantWeeksToFall };
}

/**
 * The clan town.
 *
 * Owner ruling, 2026-11-21: a clan that holds ground on the coast "can build a
 * little town there that players of that clan can access", and it looks like
 * the village screen with the clan's own mark on it. The town IS the Landing:
 * it grows with the Landing's tiers and falls with it. It invents nothing. Each
 * entry is a facility a village already has (the ids are the client's
 * FacilityId, shinobij.client/src/lib/facility-presentation.ts), so a town
 * offers a clan's members what their village offers them, a tier at a time:
 *   - Founding Camp: the Clan Hall and somewhere to eat;
 *   - Landing Hall: also a bank, a shop and a hospital;
 *   - Defended Landing: also the Mission Hall and both training halls.
 * A staked plot is ground, not a town. A dormant Landing's town is shut until
 * its upkeep is paid, and a fallen one is gone.
 */
export const COAST_TOWN_FACILITIES: readonly (readonly string[])[] = [
    [],
    ['clan-hall', 'cafeteria'],
    ['clan-hall', 'cafeteria', 'bank', 'shop', 'hospital'],
    ['clan-hall', 'cafeteria', 'bank', 'shop', 'hospital', 'mission-hall', 'stat-training', 'jutsu-training'],
];

/** The facilities a member finds in their clan's town right now. Empty when there is no town to enter. */
export function coastTownFacilities(landing: Pick<CoastLanding, 'status' | 'tier'> | null | undefined): string[] {
    if (!landing || landing.status !== 'active') return [];
    return [...(COAST_TOWN_FACILITIES[Math.max(0, Math.min(COAST_LANDING_MAX_TIER, Math.floor(Number(landing.tier) || 0)))] ?? [])];
}

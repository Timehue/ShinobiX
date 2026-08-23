import { clanBareSlug, safeName } from '../../_utils.js';
import { cleanTreasuryItems } from '../../_treasury-donate.js';
import { clearTerritoryLifecycleForCapture, settleExpiredTerritoryBreach } from '../../_territory-lifecycle.js';

export const TERRITORY_CONTROL_SCROLL_ID = 'territory-control-scroll';
export const TERRITORY_CONTROL_MAX = 75_000;
export const TERRITORY_HP_MAX = 20_000;
export const TERRITORY_CAPTURE_MIN_MEMBERS = 10;
export const TERRITORY_REBUILD_COOLDOWN_MS = 2 * 60 * 60 * 1_000;
export const TERRITORY_SCROLL_VALUE = 1_000;
export const TERRITORY_CAPTURE_SCROLLS = TERRITORY_CONTROL_MAX / TERRITORY_SCROLL_VALUE;

export type TerritoryBuffStat = 'bukijutsuOffense' | 'taijutsuOffense' | 'ninjutsuOffense' | 'genjutsuOffense';
export type TerritoryWeather = 'clear' | 'rain' | 'thunderstorm' | 'ashfall' | 'tornado' | 'desertHaze';

export type AssignableTerritory = Record<string, unknown> & {
    sector: number;
    ownerClan?: string;
    ownerVillage?: string;
    backgroundImage?: string;
    controlScore: number;
    hp: number;
    weather?: TerritoryWeather;
    terrainBuffStat: TerritoryBuffStat;
    guards: string[];
    warSupply: number;
    lastSupplyAt?: number;
    rebuiltAt?: number;
    breachedAt?: number;
    breachEndsAt?: number;
    rewardSuspendedAt?: number;
    inactiveReleaseAt?: number;
    releaseReason?: string;
    updatedAt: number;
};

export type TerritoryAssignmentPlan =
    | {
        ok: true;
        clanAfter: Record<string, unknown>;
        territoryAfter: AssignableTerritory;
        treasury: Record<string, unknown>;
        captured: boolean;
        spent: number;
    }
    | { ok: false; status: number; error: string };

function boundedInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

function defaultTerritory(sector: number, now: number): AssignableTerritory {
    return {
        sector,
        controlScore: 0,
        hp: TERRITORY_HP_MAX,
        terrainBuffStat: 'bukijutsuOffense',
        guards: [],
        warSupply: 0,
        updatedAt: now,
    };
}

export function planTerritoryScrollAssignment(args: {
    clanBefore: Record<string, unknown>;
    clanDisplayName: string;
    territoryBefore: AssignableTerritory | null;
    ownedSectorCount: number;
    sector: number;
    count: number;
    weather: TerritoryWeather;
    terrainBuffStat: TerritoryBuffStat;
    now: number;
}): TerritoryAssignmentPlan {
    const clanSlug = clanBareSlug(args.clanDisplayName);
    const unsettledTerritory = args.territoryBefore
        ? { ...args.territoryBefore }
        : defaultTerritory(args.sector, args.now);
    const territory = settleExpiredTerritoryBreach(unsettledTerritory, args.now).row as AssignableTerritory;
    const ownerClan = String(territory.ownerClan ?? '').trim();
    const ownedByClan = !!ownerClan && clanBareSlug(ownerClan) === clanSlug;

    if (ownerClan && !ownedByClan) {
        return { ok: false, status: 409, error: 'Raid or war this sector down before your clan can claim it.' };
    }

    const members = Array.isArray(args.clanBefore.members) ? args.clanBefore.members : [];
    const memberNames = members.map((member) => safeName(String(
        typeof member === 'string' ? member : (member as Record<string, unknown>)?.name ?? '',
    ))).filter(Boolean);
    const founderName = safeName(String(args.clanBefore.founderName ?? ''));
    if (founderName) memberNames.push(founderName);
    const memberCount = new Set(memberNames).size;
    if (!ownedByClan && memberCount < TERRITORY_CAPTURE_MIN_MEMBERS) {
        return {
            ok: false,
            status: 400,
            error: `Your clan needs at least ${TERRITORY_CAPTURE_MIN_MEMBERS} members to capture a sector. It currently has ${memberCount}.`,
        };
    }
    if (!ownedByClan && args.ownedSectorCount >= 1) {
        return { ok: false, status: 400, error: 'Your clan already controls a sector. Clans may only hold one sector at a time.' };
    }
    const clanVillage = String(args.clanBefore.village ?? '').trim();
    const sectorVillage = String(territory.ownerVillage ?? '').trim();
    if (!ownedByClan && sectorVillage
        && sectorVillage.toLowerCase() !== clanVillage.toLowerCase()) {
        return {
            ok: false,
            status: 409,
            error: `${sectorVillage} controls this sector. Your village must win it through a Sector War before your clan can claim it.`,
        };
    }
    if (!ownedByClan && territory.rebuiltAt) {
        const msLeft = TERRITORY_REBUILD_COOLDOWN_MS - (args.now - Number(territory.rebuiltAt));
        if (msLeft > 0) {
            const minsLeft = Math.ceil(msLeft / 60_000);
            return {
                ok: false,
                status: 400,
                error: `This sector is recovering. It can be captured again in ${minsLeft} minute${minsLeft === 1 ? '' : 's'}.`,
            };
        }
    }
    if (!ownedByClan && args.count !== TERRITORY_CAPTURE_SCROLLS) {
        return {
            ok: false,
            status: 400,
            error: `Capturing an unclaimed sector requires one committed payment of ${TERRITORY_CAPTURE_SCROLLS} Territory Control Scrolls. Partial deposits are not accepted.`,
        };
    }
    if (ownedByClan && args.count !== 1 && args.count !== 5) {
        return { ok: false, status: 400, error: 'Owned sectors can be reinforced with 1 or 5 Territory Control Scrolls.' };
    }

    const treasury = (args.clanBefore.treasury ?? {}) as Record<string, unknown>;
    const items = cleanTreasuryItems(treasury.items);
    const scrolls = items.find((stack) => stack.itemId === TERRITORY_CONTROL_SCROLL_ID)?.count ?? 0;
    if (scrolls < args.count) {
        return {
            ok: false,
            status: 400,
            error: `The clan hall needs ${args.count} Territory Control Scroll${args.count === 1 ? '' : 's'}.`,
        };
    }

    const currentScore = boundedInt(territory.controlScore, 0, TERRITORY_CONTROL_MAX, 0);
    const currentHp = boundedInt(territory.hp, 0, TERRITORY_HP_MAX, TERRITORY_HP_MAX);
    const captured = !ownerClan;
    const nextScore = captured
        ? TERRITORY_CONTROL_MAX
        : Math.min(TERRITORY_CONTROL_MAX, currentScore + args.count * TERRITORY_SCROLL_VALUE);
    const nextHp = ownedByClan
        ? Math.min(TERRITORY_HP_MAX, currentHp + args.count * TERRITORY_SCROLL_VALUE)
        : currentHp;
    if (nextScore === currentScore && nextHp === currentHp) {
        return { ok: false, status: 400, error: 'This sector is already at full control and full HP.' };
    }

    const nextItems = items
        .map((stack) => stack.itemId === TERRITORY_CONTROL_SCROLL_ID
            ? { ...stack, count: stack.count - args.count }
            : stack)
        .filter((stack) => stack.count > 0);
    const nextTreasury = { ...treasury, items: nextItems };
    let territoryAfter: AssignableTerritory = {
        ...territory,
        sector: args.sector,
        controlScore: captured ? TERRITORY_CONTROL_MAX : nextScore,
        hp: captured ? TERRITORY_HP_MAX : nextHp,
        ownerClan: captured ? args.clanDisplayName : territory.ownerClan,
        ownerVillage: captured ? sectorVillage || clanVillage || undefined : territory.ownerVillage,
        backgroundImage: captured ? String(args.clanBefore.image ?? '') || undefined : territory.backgroundImage,
        weather: captured ? args.weather : territory.weather,
        terrainBuffStat: captured ? args.terrainBuffStat : territory.terrainBuffStat,
        guards: Array.isArray(territory.guards) ? territory.guards : [],
        warSupply: captured ? 0 : Math.max(0, Math.floor(Number(territory.warSupply ?? 0))),
        lastSupplyAt: captured ? args.now : territory.lastSupplyAt,
        updatedAt: args.now,
    };
    if (captured) {
        territoryAfter = clearTerritoryLifecycleForCapture(territoryAfter) as AssignableTerritory;
    }

    return {
        ok: true,
        clanAfter: { ...args.clanBefore, treasury: nextTreasury },
        territoryAfter,
        treasury: nextTreasury,
        captured,
        spent: args.count,
    };
}

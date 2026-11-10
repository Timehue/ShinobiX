import { SECTOR_BUILDINGS, sectorBuilding } from './sector-buildings.js';
import type { BuildingReceipt, BuildingStanding, BuildingWorkOrder, SectorBuildingProgress, SharedBuildingState } from './sector-building-types.js';

import { BUILDING_DELIVERY_DAILY_CAP, BUILDING_RECEIPT_LIMIT, BUILDING_RESTORATION_TARGETS, BUILDING_RUIN_BATTLE_DAMAGE, BUILDING_RUIN_IDLE_FADE_MS, BUILDING_RUIN_INTACT_MS } from './sector-building-rules.js';
export * from './sector-building-rules.js';
export const buildingDay = (now: number) => new Date(now).toISOString().slice(0, 10);
// Lifetime work and communal revisions must keep advancing after long play.
// Only fields with an explicit gameplay bound use a smaller ceiling.
export function buildingWhole(value: unknown, ceiling = Number.MAX_SAFE_INTEGER): number {
    const number = Number(value); return Number.isFinite(number) ? Math.min(ceiling, Math.max(0, Math.floor(number))) : 0;
}
export const EMPTY_BUILDING_STANDING = (): BuildingStanding => ({ metAt: 0, trust: 0, visits: 0, visitDay: '', repairCount: 0 });
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 160) => typeof value === 'string' ? value.slice(0,max) : '';

/** Generic saves cannot write this state. Parsing also bounds legacy/corrupt stored rows. */
export function readBuildingProgress(value: unknown, now: number): SectorBuildingProgress {
    const raw = object(value), day = buildingDay(now), standing: Record<string, BuildingStanding> = {};
    for (const building of SECTOR_BUILDINGS) {
        const entry = object(object(raw.standing)[building.id]); if (!Object.keys(entry).length) continue;
        const survey = object(entry.survey);
        standing[building.id] = { metAt: buildingWhole(entry.metAt, Number.MAX_SAFE_INTEGER), trust: buildingWhole(entry.trust, 100),
            visits: buildingWhole(entry.visits), visitDay: text(entry.visitDay,10), repairCount: buildingWhole(entry.repairCount),
            ...(Object.keys(survey).length ? { survey: { step: buildingWhole(survey.step,3),
                evidence: Array.isArray(survey.evidence) ? survey.evidence.filter(v => typeof v === 'string').slice(0,3) : [],
                ...(survey.recordedAt ? { recordedAt: buildingWhole(survey.recordedAt, Number.MAX_SAFE_INTEGER), interpretation: text(survey.interpretation,40) } : {}) } } : {}),
            ...(entry.registerEntry ? { registerEntry: text(entry.registerEntry,80) } : {}),
            ...(entry.suspicionUntil ? { suspicionUntil: buildingWhole(entry.suspicionUntil, Number.MAX_SAFE_INTEGER) } : {}),
            ...(entry.teaUntil ? { teaUntil: buildingWhole(entry.teaUntil, Number.MAX_SAFE_INTEGER) } : {}),
            ...(entry.intelDay ? { intelDay: text(entry.intelDay,10) } : {}), ...(entry.festivalDay ? { festivalDay: text(entry.festivalDay,10) } : {}),
            ...(entry.watchDay ? { watchDay: text(entry.watchDay,10) } : {}),
        };
    }
    const activeRaw = object(raw.active), activeBuilding = sectorBuilding(activeRaw.buildingId);
    const kinds = ['repair','courier','watch','intelligence','festival','tea'];
    const active = activeBuilding && kinds.includes(String(activeRaw.kind)) && typeof activeRaw.id === 'string'
        ? { id: text(activeRaw.id,100), buildingId: activeBuilding.id, kind: activeRaw.kind as BuildingWorkOrder['kind'],
            startedAt: buildingWhole(activeRaw.startedAt,Number.MAX_SAFE_INTEGER), stepAt: buildingWhole(activeRaw.stepAt,Number.MAX_SAFE_INTEGER),
            step: buildingWhole(activeRaw.step,12), day: text(activeRaw.day,10),
            ...(['cedar','reed','stone'].includes(String(activeRaw.protocol))?{protocol:activeRaw.protocol as BuildingWorkOrder['protocol']}:{}),
            ...(activeRaw.kind==='watch'?{watchStage:buildingWhole(activeRaw.watchStage,3)}:{}),
            ...(activeRaw.restored===true&&activeRaw.kind!=='repair'&&activeRaw.kind!=='tea'?{restored:true}:{}),
            ...(activeRaw.materials ? { materials: Object.fromEntries(Object.entries(object(activeRaw.materials)).filter(([id,n]) => /^(gather-|hunt-)/.test(id) && buildingWhole(n,100) > 0).map(([id,n]) => [id,buildingWhole(n,100)])) } : {}),
            ...(Array.isArray(activeRaw.route) ? { route: activeRaw.route.filter(id => sectorBuilding(id)).slice(0,8) as string[] } : {}),
            ...(Array.isArray(activeRaw.observations) ? { observations: activeRaw.observations.filter(v => typeof v === 'string').slice(0,8) as string[] } : {}),
        } satisfies BuildingWorkOrder : undefined;
    return { version: 1, standing, ...(active ? { active } : {}), repairs: buildingWhole(raw.repairs), deliveries: buildingWhole(raw.deliveries),
        watches: buildingWhole(raw.watches), surveys: buildingWhole(raw.surveys), day,
        repairsToday: raw.day === day ? buildingWhole(raw.repairsToday) : 0,
        deliveriesToday: raw.day === day ? buildingWhole(raw.deliveriesToday,BUILDING_DELIVERY_DAILY_CAP) : 0,
        rewardsToday: raw.day === day ? buildingWhole(raw.rewardsToday) : 0,
        shardClaims: buildingWhole(raw.shardClaims),
        receipts: Array.isArray(raw.receipts) ? raw.receipts.filter((entry): entry is BuildingReceipt => {
            const r = object(entry); return typeof r.requestId === 'string' && !!sectorBuilding(r.buildingId) && typeof r.action === 'string' && typeof r.message === 'string' && !!r.reward && Number.isSafeInteger(r.at);
        }).slice(-BUILDING_RECEIPT_LIMIT) : [],
        titles: Array.isArray(raw.titles) ? raw.titles.filter((v): v is string => typeof v === 'string' && ['Road Restorer','Trusted Courier','Chronicle Field Witness','Bridge Watch Volunteer','Sunscar Participant'].includes(v)).slice(0,5) : [],
    };
}
/** Pass `ruin` for a building painted as a ruin. Its stages count only the
 * current restoration cycle: the full cycle stands intact for
 * BUILDING_RUIN_INTACT_MS, then the ruin returns and the cycle restarts.
 * Without it, stages follow lifetime repairs and never lapse. */
export function readSharedBuilding(value: unknown, ruin?: { now: number }): SharedBuildingState {
    const raw = object(value), repairs = buildingWhole(raw.repairs), updatedAt = buildingWhole(raw.updatedAt,Number.MAX_SAFE_INTEGER);
    const base = { version: 1 as const, revision: buildingWhole(raw.revision), repairs, updatedAt,
        contributors: Array.isArray(raw.contributors) ? raw.contributors.slice(0,20).map(row => ({ name: text(object(row).name,32), repairs: buildingWhole(object(row).repairs) })).filter(row=>row.name) : [],
        reports: Array.isArray(raw.reports) ? raw.reports.slice(-8).map(row => ({ name: text(object(row).name,32), at: buildingWhole(object(row).at,Number.MAX_SAFE_INTEGER), text: text(object(row).text,640) })).filter(row=>row.name && row.text) : [],
        // Battle damage bookkeeping survives every read, so a later write never re-opens a counted battle.
        ...(Array.isArray(raw.damagedBy) ? { damagedBy: raw.damagedBy.filter((id): id is string => typeof id === 'string').map(id => id.slice(0, 100)).slice(-20) } : {}),
        ...(typeof raw.damageDay === 'string' ? { damageDay: text(raw.damageDay, 10), damageToday: buildingWhole(raw.damageToday, BUILDING_RUIN_BATTLE_DAMAGE.dailyLimit) } : {}),
    };
    // Keep a stored ruin cycle intact through any plain read so no writer drops it.
    if (!ruin) return { ...base, stage: BUILDING_RESTORATION_TARGETS.filter(n => repairs >= n).length,
        ...(raw.cycleRepairs !== undefined ? { cycleRepairs: buildingWhole(raw.cycleRepairs, BUILDING_RESTORATION_TARGETS[2]) } : {}),
        ...(raw.intactUntil ? { intactUntil: buildingWhole(raw.intactUntil, Number.MAX_SAFE_INTEGER) } : {}),
        ...(raw.cycleAt ? { cycleAt: buildingWhole(raw.cycleAt, Number.MAX_SAFE_INTEGER) } : {}) };
    const full = BUILDING_RESTORATION_TARGETS[2];
    // Rows written before the timer existed have no cycle: their lifetime count is the cycle.
    let cycle = Math.min(full, raw.cycleRepairs === undefined ? repairs : buildingWhole(raw.cycleRepairs));
    let intactUntil = cycle >= full ? buildingWhole(raw.intactUntil,Number.MAX_SAFE_INTEGER) : 0;
    // A full cycle without a recorded end started at its last write (or now, if unknown).
    if (cycle >= full && !intactUntil) intactUntil = (updatedAt || ruin.now) + BUILDING_RUIN_INTACT_MS;
    if (intactUntil && ruin.now >= intactUntil) { cycle = 0; intactUntil = 0; }
    // Abandoned work fades: an unfinished cycle idle for BUILDING_RUIN_IDLE_FADE_MS starts over.
    const cycleAt = buildingWhole(raw.cycleAt, Number.MAX_SAFE_INTEGER) || updatedAt || ruin.now;
    if (cycle > 0 && cycle < full && ruin.now - cycleAt >= BUILDING_RUIN_IDLE_FADE_MS) cycle = 0;
    return { ...base, stage: BUILDING_RESTORATION_TARGETS.filter(n => cycle >= n).length, cycleRepairs: cycle,
        ...(cycle ? { cycleAt } : {}), ...(intactUntil ? { intactUntil } : {}) };
}
/** A verified world PvP battle in the ruin's sector. `battleAt` (when it ended) keys
 * the daily limit, so a battle the limit skipped cannot land on a later day when
 * settlement replays. Returns the damaged row, or undefined when this battle was
 * already counted, belongs to an earlier damage day, its day's limit is spent, or
 * there is nothing standing or under way to damage. */
export function applyRuinBattleDamage(value: unknown, battleId: string, now: number, battleAt = now): SharedBuildingState | undefined {
    const shared = readSharedBuilding(value, { now }), day = buildingDay(battleAt);
    if (!battleId || shared.damagedBy?.includes(battleId)) return;
    if (shared.damageDay && day < shared.damageDay) return;
    const today = shared.damageDay === day ? shared.damageToday ?? 0 : 0;
    if (today >= BUILDING_RUIN_BATTLE_DAMAGE.dailyLimit) return;
    const next: SharedBuildingState = { ...shared };
    if (shared.stage === 3 && shared.intactUntil) {
        const until = shared.intactUntil - BUILDING_RUIN_BATTLE_DAMAGE.standingMs;
        if (until > now) next.intactUntil = until;
        else { next.cycleRepairs = 0; delete next.intactUntil; delete next.cycleAt; }
    } else if ((shared.cycleRepairs ?? 0) > 0) next.cycleRepairs = Math.max(0, shared.cycleRepairs! - BUILDING_RUIN_BATTLE_DAMAGE.cycleRepairs);
    else return;
    return readSharedBuilding({ ...next, revision: shared.revision + 1, updatedAt: now,
        damagedBy: [...shared.damagedBy ?? [], battleId].slice(-20), damageDay: day, damageToday: today + 1 }, { now });
}
export const buildingStanding = (state: SectorBuildingProgress, id: string) => state.standing[id] ?? EMPTY_BUILDING_STANDING();

import { SECTOR_BUILDINGS, sectorBuilding } from './sector-buildings.js';
import type { BuildingReceipt, BuildingStanding, BuildingWorkOrder, SectorBuildingProgress, SharedBuildingState } from './sector-building-types.js';

import { BUILDING_DELIVERY_DAILY_CAP, BUILDING_RECEIPT_LIMIT, BUILDING_RESTORATION_TARGETS } from './sector-building-rules.js';
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
export function readSharedBuilding(value: unknown): SharedBuildingState {
    const raw = object(value), repairs = buildingWhole(raw.repairs);
    return { version: 1, revision: buildingWhole(raw.revision), repairs, stage: BUILDING_RESTORATION_TARGETS.filter(n => repairs >= n).length,
        updatedAt: buildingWhole(raw.updatedAt,Number.MAX_SAFE_INTEGER),
        contributors: Array.isArray(raw.contributors) ? raw.contributors.slice(0,20).map(row => ({ name: text(object(row).name,32), repairs: buildingWhole(object(row).repairs) })).filter(row=>row.name) : [],
        reports: Array.isArray(raw.reports) ? raw.reports.slice(-8).map(row => ({ name: text(object(row).name,32), at: buildingWhole(object(row).at,Number.MAX_SAFE_INTEGER), text: text(object(row).text,640) })).filter(row=>row.name && row.text) : [],
    };
}
export const buildingStanding = (state: SectorBuildingProgress, id: string) => state.standing[id] ?? EMPTY_BUILDING_STANDING();

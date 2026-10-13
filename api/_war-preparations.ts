import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { normalizeVillageWarRecord, villageWarKey, type VillageWarRecord } from './_war-state.js';
import { listActiveSectorWars, loadSectorWar } from './_sector-war-store.js';
import { isSectorWarActive, sectorWarInstanceTag, type SectorWarSession } from './_sector-war.js';
import { villageWarGeneration } from './_merc-context.js';
import { emptyPreparationLevels, preparationCost, preparationMaxTier, WAR_PREPARATION_KEYS, type WarPreparationKey, type WarPreparation, type WarPreparationContext } from '../shared/war-preparations.js';
import type { CampaignWarRow } from './_village-war-campaign.js';

export function campaignPreparationInstance(war: CampaignWarRow): string {
    return `village:${war.id}:g${villageWarGeneration(war as unknown as Record<string, unknown>)}`;
}
export function sectorPreparationInstance(war: Pick<SectorWarSession, 'id' | 'startedAt' | 'declarationGeneration'>): string {
    return `sector:${war.id}:${sectorWarInstanceTag(war)}`;
}
export function campaignPreparationContext(war: CampaignWarRow, village: string, now: number): WarPreparationContext | null {
    if (!war?.campaign || war.endedAt || !war.villages.includes(village) || now >= war.campaign.endsAt
        || (war.declarationFunding && war.declarationFunding.status !== 'active')) return null;
    return { instance: campaignPreparationInstance(war), rowKey: `world:war:${war.id}`, kind: 'village', id: war.id,
        enemy: war.villages.find(v => v !== village)!, startsAt: war.campaign.startsAt, endsAt: war.campaign.endsAt };
}
export function sectorPreparationContext(war: SectorWarSession, village: string, now: number): WarPreparationContext | null {
    if (!isSectorWarActive(war, now) || ![war.attackerVillage, war.defenderVillage].includes(village)) return null;
    return { instance: sectorPreparationInstance(war), rowKey: `shared:sector-war:${war.id}`, kind: 'sector', id: war.id,
        enemy: war.attackerVillage === village ? war.defenderVillage : war.attackerVillage,
        startsAt: war.startedAt, endsAt: war.endsAt, sector: war.sector };
}
export async function listWarPreparationContexts(village: string, now = Date.now()): Promise<WarPreparationContext[]> {
    const [keys, sectors] = await Promise.all([kv.keys('world:war:*'), listActiveSectorWars(now)]);
    const wars = keys.length ? await kv.mget<CampaignWarRow[]>(...keys) : [];
    return [...wars.flatMap(w => { const c = w ? campaignPreparationContext(w, village, now) : null; return c ? [c] : []; }),
        ...sectors.flatMap(w => { const c = sectorPreparationContext(w, village, now); return c ? [c] : []; })];
}
/** Called again with this row's lock held before spending; never trust a UI context. */
export async function liveWarPreparationContext(context: WarPreparationContext, village: string, now = Date.now()) {
    const live = context.kind === 'village'
        ? campaignPreparationContext(await kv.get<CampaignWarRow>(context.rowKey) as CampaignWarRow, village, now)
        : await loadSectorWar(context.id).then(w => w ? sectorPreparationContext(w, village, now) : null);
    return live?.instance === context.instance ? live : null;
}
export function preparationLevels(record: VillageWarRecord, instance: string, now = Date.now()) {
    if (record.dormant) return emptyPreparationLevels();
    const preparation = record.warPreparations?.find(p => p.instance === instance && p.endsAt > now);
    return preparation?.levels ?? emptyPreparationLevels();
}
export async function campaignSupportTiers(war: CampaignWarRow, village: string, at: number) {
    const record = normalizeVillageWarRecord(village, await kv.get(villageWarKey(village)) ?? undefined);
    return preparationLevels(record, campaignPreparationInstance(war), at);
}
/** Alert receipts are co-written with their bounded log. Failures never rewind a battle. */
export async function recordPreparationAttack(context: WarPreparationContext, village: string, id: string,
    sector: number, mode: 'combat' | 'pet' | 'card', at = Date.now()): Promise<void> {
    const key = villageWarKey(village);
    await withKvLock(key, async () => {
        const record = normalizeVillageWarRecord(village, await kv.get(key) ?? undefined);
        if (!preparationLevels(record, context.instance, at).watchtower) return;
        const p = record.warPreparations!.find(p => p.instance === context.instance)!;
        if (p.alerts.some(a => a.id === id)) return;
        p.alerts = [...p.alerts, { id, at, sector, mode }].slice(-30);
        await kv.set(key, record);
    }, { failClosed: true });
}
export function preparationView(context: WarPreparationContext, record: VillageWarRecord): WarPreparation {
    const stored = record.warPreparations?.find(p => p.instance === context.instance);
    return { ...context, levels: stored?.levels ?? emptyPreparationLevels(), alerts: stored?.alerts ?? [] };
}
export async function alertSectorPreparation(war: SectorWarSession, id: string, mode: 'combat' | 'pet' | 'card', at: number,
    targetVillage = war.defenderVillage): Promise<void> {
    const context = sectorPreparationContext(war, targetVillage, at);
    if (context) await recordPreparationAttack(context, targetVillage, id, war.sector, mode, at);
}
export async function upgradeWarPreparation(village: string, structure: string, instance: string, toLevel: number | null) {
    if (structure === 'ramparts') return { ok: false as const, error: 'retired-structure' };
    if (!WAR_PREPARATION_KEYS.includes(structure as WarPreparationKey)) return { ok: false as const, error: 'unknown-structure' };
    if (!instance || toLevel === null) return { ok: false as const, error: 'war-required' };
    const context = (await listWarPreparationContexts(village)).find(c => c.instance === instance);
    if (!context) return { ok: false as const, error: 'war-ended' };
    return withKvLock(context.rowKey, () => withKvLock(villageWarKey(village), async () => {
        const live = await liveWarPreparationContext(context, village);
        if (!live) return { ok: false as const, error: 'war-ended' };
        const record = normalizeVillageWarRecord(village, await kv.get(villageWarKey(village)) ?? undefined);
        const key = structure as WarPreparationKey;
        const prep = preparationView(live, record), currentLevel = prep.levels[key];
        if (toLevel === currentLevel) return { ok: true as const, structure, newLevel: currentLevel,
            currency: 'wr' as const, remainingWr: record.warResources, cost: preparationCost(currentLevel - 1), replayed: true, warInstance: instance };
        if (toLevel !== currentLevel + 1) return { ok: false as const, error: 'level-changed', currentLevel };
        if (currentLevel >= preparationMaxTier(live.kind, key)) return { ok: false as const, error: 'max-level' };
        const cost = preparationCost(currentLevel);
        if (record.warResources < cost) return { ok: false as const, error: 'insufficient-wr', cost };
        // One row holds both the debit and granted tier. A lost answer is replayable.
        const retained = (record.warPreparations ?? []).filter(p => p.instance !== instance && p.endsAt > Date.now());
        if (retained.length >= 31) return { ok: false as const, error: 'preparation-limit' };
        prep.levels = { ...prep.levels, [key]: toLevel };
        await kv.set(villageWarKey(village), { ...record, warResources: record.warResources - cost, warPreparations: [...retained, prep] });
        return { ok: true as const, structure, newLevel: toLevel, cost, currency: 'wr' as const,
            remainingWr: record.warResources - cost, warInstance: instance };
    }, { failClosed: true }), { failClosed: true });
}

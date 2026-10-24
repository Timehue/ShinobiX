import { kv } from './_storage.js';
import { withKvLock } from './_lock.js';
import { normalizeVillageWarRecord, villageWarKey, type VillageWarRecord } from './_war-state.js';
import { listActiveSectorWars, loadSectorWar } from './_sector-war-store.js';
import { isSectorWarActive, sectorWarInstanceTag, type SectorWarSession } from './_sector-war.js';
import { villageWarGeneration } from './_merc-context.js';
import { emptyPreparationLevels, preparationCost, preparationMaxTier, preparationTreasuryCost, WAR_PREPARATION_KEYS, type WarPreparationKey, type WarPreparation, type WarPreparationContext } from '../shared/war-preparations.js';
import type { CampaignWarRow } from './_village-war-campaign.js';
import { ryoPerWr } from './_war-economy.js';
import { findWarTreasuryPayment, treasuryBalances, villageTreasuryKey, withWarTreasuryPayment } from './_war-treasury-payment.js';

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
/** The payment ref of one preparation tier: per war instance, key and tier. */
export function preparationPaymentRef(instance: string, key: WarPreparationKey, tier: number): string {
    return `${instance}:${key}:${tier}`;
}

/**
 * Buy the next tier of a preparation for one war. The price is WR plus treasury
 * ryo and Bone Charms per WR (2026-10 rebalance, #6; WAR_RYO_PER_WR, default
 * 250 ryo + 0.5 BC per WR). Lock order: the war's own row, then the village
 * treasury row, then the war chest. When the treasury pays anything, its debit,
 * the payment proof and the granted tier commit in ONE kv.compareSetMany, so
 * the two rows never disagree; a mismatch moves nothing ('treasury-busy').
 * Choosing the level that is already bought replays and charges nothing.
 */
export async function upgradeWarPreparation(village: string, structure: string, instance: string, toLevel: number | null, perWr: number = ryoPerWr()) {
    if (structure === 'ramparts') return { ok: false as const, error: 'retired-structure' };
    if (!WAR_PREPARATION_KEYS.includes(structure as WarPreparationKey)) return { ok: false as const, error: 'unknown-structure' };
    if (!instance || toLevel === null) return { ok: false as const, error: 'war-required' };
    const context = (await listWarPreparationContexts(village)).find(c => c.instance === instance);
    if (!context) return { ok: false as const, error: 'war-ended' };
    const warKey = villageWarKey(village);
    const stateKey = villageTreasuryKey(village);
    return withKvLock(context.rowKey, () => withKvLock(stateKey, () => withKvLock(warKey, async () => {
        const live = await liveWarPreparationContext(context, village);
        if (!live) return { ok: false as const, error: 'war-ended' };
        const rawRecord = (await kv.get<Record<string, unknown>>(warKey)) ?? null;
        const record = normalizeVillageWarRecord(village, rawRecord ?? undefined);
        const key = structure as WarPreparationKey;
        const prep = preparationView(live, record), currentLevel = prep.levels[key];
        if (toLevel === currentLevel) {
            const paid = currentLevel > 0
                ? findWarTreasuryPayment(await kv.get<Record<string, unknown>>(stateKey), 'prep', village, preparationPaymentRef(instance, key, currentLevel))
                : null;
            return { ok: true as const, structure, newLevel: currentLevel,
                currency: 'wr' as const, remainingWr: record.warResources, cost: preparationCost(currentLevel - 1),
                treasuryRyo: paid?.ryo ?? 0, treasuryBoneCharms: paid?.boneCharms ?? 0, replayed: true, warInstance: instance };
        }
        if (toLevel !== currentLevel + 1) return { ok: false as const, error: 'level-changed', currentLevel };
        if (currentLevel >= preparationMaxTier(live.kind, key)) return { ok: false as const, error: 'max-level' };
        const price = preparationTreasuryCost(currentLevel, perWr);
        const cost = price.wr;
        if (record.warResources < cost) return { ok: false as const, error: 'insufficient-wr', cost };
        const retained = (record.warPreparations ?? []).filter(p => p.instance !== instance && p.endsAt > Date.now());
        if (retained.length >= 31) return { ok: false as const, error: 'preparation-limit' };
        prep.levels = { ...prep.levels, [key]: toLevel };
        const nextRecord = { ...record, warResources: record.warResources - cost, warPreparations: [...retained, prep] };
        const granted = { ok: true as const, structure, newLevel: toLevel, cost, currency: 'wr' as const,
            remainingWr: record.warResources - cost, warInstance: instance };
        if (price.ryo <= 0 && price.boneCharms <= 0) {
            // WR only (the dial at 0): one row holds both the debit and the tier.
            await kv.set(warKey, nextRecord);
            return { ...granted, treasuryRyo: 0, treasuryBoneCharms: 0 };
        }
        const rawState = (await kv.get<Record<string, unknown>>(stateKey)) ?? null;
        const have = treasuryBalances(rawState);
        if (have.ryo < price.ryo) return { ok: false as const, error: 'insufficient-treasury-ryo', cost, need: price.ryo, have: have.ryo };
        if (have.boneCharms < price.boneCharms) return { ok: false as const, error: 'insufficient-treasury-bc', cost, need: price.boneCharms, have: have.boneCharms };
        if (typeof kv.compareSetMany !== 'function') return { ok: false as const, error: 'treasury-busy' };
        const nextState = withWarTreasuryPayment(rawState ?? {}, {
            kind: 'prep', village, ref: preparationPaymentRef(instance, key, toLevel), ryo: price.ryo, boneCharms: price.boneCharms,
        }, Date.now());
        const committed = await kv.compareSetMany([
            { op: 'cas', key: stateKey, expected: rawState, value: nextState },
            { op: 'cas', key: warKey, expected: rawRecord, value: nextRecord },
        ]);
        if (!committed) return { ok: false as const, error: 'treasury-busy' };
        return { ...granted, treasuryRyo: price.ryo, treasuryBoneCharms: price.boneCharms,
            remainingTreasuryRyo: have.ryo - price.ryo, remainingTreasuryBoneCharms: have.boneCharms - price.boneCharms };
    }, { failClosed: true }), { failClosed: true }), { failClosed: true });
}

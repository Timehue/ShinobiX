import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CampaignFieldMissionView, CampaignView } from '../../../../shared/village-war-campaign';
import { sectorVaultMarker } from './sector-vault-marker';
const village = 'Moonshadow Village';
const campaign = (): CampaignView => ({ version: 2, startsAt: Date.now() - 1000, endsAt: Date.now() + 100_000,
    shrine: [], strongholds: [], scores: {}, intel: 0, hiddenStrongholds: 3,
    operationAllowance: { total: 0, categories: {}, players: {} }, operationResetAt: Date.now() + 100_000 });
test('war defenders can physically enter owned ordinary strongholds at level 15', () => {
    let entered: unknown;
    const marker = sectorVaultMarker({ campaign: campaign(), sector: 17, village, level: 15, anbuViewOpen: true,
        ownerVillage: village, onOpen: target => { entered = target; } });
    assert.ok(marker); assert.equal('defending' in marker && marker.defending, true); marker.onOpen();
    assert.deepEqual(entered, { sector: 17, village, warEntry: true });
});
test('owned defensive entry stays unavailable outside an active campaign, below level 15 or when paused', () => {
    const active = campaign();
    for (const settings of [{ campaign: undefined }, { campaign: { ...active, startsAt: Date.now() + 1000 } },
        { campaign: { ...active, endsAt: Date.now() - 1000 } }, { level: 14 }, { anbuViewOpen: false }])
        assert.equal(sectorVaultMarker({ campaign: active, sector: 17, village, level: 15, anbuViewOpen: true,
            ownerVillage: village, onOpen() {}, ...settings }), null);
});
test('owned nominated objectives retain their specialty queue rather than gaining ordinary infiltration', () => {
    for (const mode of ['combat', 'pet', 'card'] as const) {
        const active = campaign(); active.strongholds.push({ id: 'own-objective', sector: 17, village, mode,
            opensAt: active.startsAt, closesAt: active.endsAt, limit: 3, bouts: 0, wins: {} });
        assert.equal(sectorVaultMarker({ campaign: active, sector: 17, village, level: 100, anbuViewOpen: true, ownerVillage: village, onOpen() {} }), null);
    }
});
test('ordinary exploration keeps live-main level-50 admission while known war objectives keep level-15 admission', () => {
    assert.equal(sectorVaultMarker({ sector: 9, village, level: 49, anbuViewOpen: true, ownerVillage: 'Ashen Leaf Village', onOpen() {} }), null);
    assert.ok(sectorVaultMarker({ sector: 9, village, level: 50, anbuViewOpen: true, ownerVillage: 'Ashen Leaf Village', onOpen() {} }));
    const active = campaign(); active.strongholds.push({ id: 'enemy-pet', sector: 9, village: 'Ashen Leaf Village', mode: 'pet',
        opensAt: active.startsAt, closesAt: active.endsAt, limit: 3, bouts: 0, wins: {} });
    const marker = sectorVaultMarker({ campaign: active, sector: 9, village, level: 15, anbuViewOpen: true, ownerVillage: 'Ashen Leaf Village', onOpen() {} });
    assert.ok(marker); assert.equal(marker.village, 'Ashen Leaf Village');
});
test('ordinary allied and Obsidian exploration retain live-main admission at peace', () => {
    for (const sector of [17, 99]) {
        assert.equal(sectorVaultMarker({ sector, village, level: 49, anbuViewOpen: true, ownerVillage: village, onOpen() {} }), null);
        assert.ok(sectorVaultMarker({ sector, village, level: 50, anbuViewOpen: true, ownerVillage: village, onOpen() {} }));
    }
});
test('assigned espionage admits level-15 war entry without revealing unrelated enemy strongholds', () => {
    const active = campaign();
    const mission: CampaignFieldMissionView = { id: 'spy', kind: 'espionage', village, enemy: 'Ashen Leaf Village',
        createdAt: Date.now(), sectors: [9], completedSectors: [], status: 'active', holdSeconds: 0, holdRequired: 0,
        insideStronghold: false, serverNow: Date.now() };
    let entered: unknown;
    const options = { campaign: active, mission, sector: 9, village, level: 15, anbuViewOpen: true,
        ownerVillage: mission.enemy, onOpen: (target: unknown) => { entered = target; } };
    const marker = sectorVaultMarker(options);
    assert.ok(marker); marker.onOpen();
    assert.deepEqual(entered, { sector: 9, village: mission.enemy, warEntry: true });
    for (const changes of [{ level: 14 }, { sector: 10 }, { anbuViewOpen: false },
        { mission: { ...mission, status: 'complete' as const } }, { campaign: { ...active, endsAt: Date.now() - 1000 } }])
        assert.equal(sectorVaultMarker({ ...options, ...changes }), null);
});
test('nominated objectives cannot bypass a paused capability or remain level-15 entrances after closing', () => {
    const active = campaign(); active.strongholds.push({ id: 'enemy-pet', sector: 9, village: 'Ashen Leaf Village', mode: 'pet',
        opensAt: active.startsAt, closesAt: active.endsAt, limit: 3, bouts: 0, wins: {} });
    for (const settings of [{ anbuViewOpen: false }, { campaign: { ...active, endsAt: Date.now() - 1000 } }])
        assert.equal(sectorVaultMarker({ campaign: active, sector: 9, village, level: 15, anbuViewOpen: true,
            ownerVillage: 'Ashen Leaf Village', onOpen() {}, ...settings }), null);
});

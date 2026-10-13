import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CampaignView } from '../../../../shared/village-war-campaign';
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
    assert.deepEqual(entered, { sector: 17, village });
});
test('owned defensive entry stays unavailable outside an active campaign, below level 15 or when paused', () => {
    const active = campaign();
    for (const settings of [{ campaign: undefined }, { campaign: { ...active, startsAt: Date.now() + 1000 } },
        { campaign: { ...active, endsAt: Date.now() - 1000 } }, { level: 14 }, { anbuViewOpen: false }])
        assert.equal(sectorVaultMarker({ campaign: active, sector: 17, village, level: 100, anbuViewOpen: true,
            ownerVillage: village, onOpen() {}, ...settings }), null);
});
test('owned nominated objectives retain their specialty queue rather than gaining ordinary infiltration', () => {
    for (const mode of ['combat', 'pet', 'card'] as const) {
        const active = campaign(); active.strongholds.push({ id: 'own-objective', sector: 17, village, mode,
            opensAt: active.startsAt, closesAt: active.endsAt, limit: 3, bouts: 0, wins: {} });
        assert.equal(sectorVaultMarker({ campaign: active, sector: 17, village, level: 100, anbuViewOpen: true, ownerVillage: village, onOpen() {} }), null);
    }
});
test('enemy infiltration keeps its normal gate while known war objectives keep level-15 admission', () => {
    assert.equal(sectorVaultMarker({ sector: 9, village, level: 99, anbuViewOpen: true, ownerVillage: 'Ashen Leaf Village', onOpen() {} }), null);
    assert.ok(sectorVaultMarker({ sector: 9, village, level: 100, anbuViewOpen: true, ownerVillage: 'Ashen Leaf Village', onOpen() {} }));
    const active = campaign(); active.strongholds.push({ id: 'enemy-pet', sector: 9, village: 'Ashen Leaf Village', mode: 'pet',
        opensAt: active.startsAt, closesAt: active.endsAt, limit: 3, bouts: 0, wins: {} });
    const marker = sectorVaultMarker({ campaign: active, sector: 9, village, level: 15, anbuViewOpen: true, ownerVillage: 'Ashen Leaf Village', onOpen() {} });
    assert.ok(marker); assert.equal(marker.village, 'Ashen Leaf Village');
});

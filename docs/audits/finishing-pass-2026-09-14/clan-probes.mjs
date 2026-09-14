// Disposable-memory diagnostic evidence. It deliberately records existing gaps;
// it is not a passing regression test that endorses the defective behavior.
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'finishing-pass-memory-only';
delete process.env.SESSION_SECRET;
const { kv } = await import('../../../api/_storage.ts');
const progress = (await import('../../../api/pet/progress.ts')).default;
const mission = (await import('../../../api/clan/mission/claim.ts')).default;
const exchange = (await import('../../../api/clan/exchange/purchase.ts')).default;
const { validateClanSaveWrite } = await import('../../../api/_clan-save-validate.ts');
const { PET_BREEDING_MIGRATION_VERSION } = await import('../../../api/pet/_owned-pet.ts');
const { getPetXpBonus } = await import('../../../shinobij.client/src/lib/village-upgrades.ts');
async function post(handler, body) {
    const result = { status: 200, body: null };
    const res = { setHeader() { return res; }, status(n) { result.status = n; return res; }, json(b) { result.body = b; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, query: {}, headers: { 'x-admin-password': process.env.ADMIN_PASSWORD }, socket: { remoteAddress: '127.0.0.93' } }, res);
    return result;
}
const output = { base: 'ecd8d6ccaba017a6791ec0ec94f822c10658984d', target: 'disposable memory only', petTraining: [], clanMission: {} };
for (const [label, benefits] of [['baseline', {}], ['Pet Den level 50', { clan: 'Audit Clan', clanUpgradeLevels: { petDen: 50 } }], ['Pet Yard level 50', { villageUpgrades: { petYard: 50 } }]]) {
    const character = { name: 'auditpet', level: 50, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, pets: [{ id: 'audit-pet', name: 'Fang', rarity: 'standard', level: 5, maxLevel: 100, xp: 0, happiness: 100, happinessDay: Math.floor(Date.now() / 86_400_000), hp: 500, attack: 40, defense: 40, speed: 40, jutsus: [] }], activePetId: 'audit-pet', ...benefits };
    await kv.set('save:auditpet', { _saveVersion: 1, character });
    const result = await post(progress, { playerName: 'auditpet', petId: 'audit-pet', action: 'start-training', focus: 'bond', durationMs: 14_400_000 });
    assert.equal(result.status, 200, JSON.stringify(result));
    const saved = await kv.get('save:auditpet');
    output.petTraining.push({ label, shownBonusPercent: getPetXpBonus(character), sealedXp: saved.character.pets[0].training.sealedXp });
}
const clanKey = 'save:clan-auditclan';
await kv.set(clanKey, { name: 'Audit Clan', level: 1, xp: 0, treasury: { ryo: 1000 }, members: [{ name: 'auditmember', battleContrib: 20 }] });
await kv.set('save:auditmember', { _saveVersion: 1, character: { name: 'auditmember', clan: 'Audit Clan', ryo: 1000 } });
const originalSet = kv.set.bind(kv);
const originalNow = Date.now;
let injected = false;
try {
    kv.set = async (key, ...args) => {
        if (key === clanKey && !injected) { injected = true; throw new Error('audit: interrupted before clan credit'); }
        return originalSet(key, ...args);
    };
    const body = { playerName: 'auditmember', clan: 'Audit Clan', missionKey: 'battle' };
    const first = await post(mission, body);
    kv.set = originalSet;
    Date.now = () => originalNow() + 61_000;
    const retry = await post(mission, body);
    const saved = await kv.get(clanKey);
    output.clanMission = { injectedBeforeClanWrite: injected, firstStatus: first.status, retryStatus: retry.status, retryBody: retry.body, persistedRyo: saved.treasury.ryo, persistedClanXp: saved.xp, receipts: await kv.keys('clan:mission-claimed:*') };
} finally { kv.set = originalSet; Date.now = originalNow; }
// The acknowledgement is lost AFTER storage applies the treasury credit.
await kv.set(clanKey, { name: 'Audit Clan', level: 25, xp: 0, treasury: { warSupply: 10 }, members: [{ name: 'auditmember' }] });
await kv.set('save:auditmember', { _saveVersion: 1, character: { name: 'auditmember', clan: 'Audit Clan', clanPoints: 4000 } });
injected = false;
try {
    kv.set = async (key, ...args) => {
        const result = await originalSet(key, ...args);
        if (key === clanKey && !injected) { injected = true; throw new Error('audit: lost acknowledgement after treasury credit'); }
        return result;
    };
    const result = await post(exchange, { playerName: 'auditmember', clan: 'Audit Clan', itemId: 'greaterWarSupplyGrant' });
    kv.set = originalSet;
    output.clanExchangeLostAck = { injected, status: result.status, response: result.body, warSupply: (await kv.get(clanKey)).treasury.warSupply, clanPoints: (await kv.get('save:auditmember')).character.clanPoints };
} finally { kv.set = originalSet; }
const previousClan = { name: 'Audit Clan', founderName: 'auditmember', members: [{ name: 'auditmember' }], treasury: { ryo: 1000 }, settlementReceipts: [{ transactionId: 'real', fingerprint: 'real' }] };
output.clanReceiptWrite = {
    clear: validateClanSaveWrite(previousClan, { ...previousClan, settlementReceipts: [] }, { callerName: 'auditmember', isAdmin: false }).next.settlementReceipts,
    forge: validateClanSaveWrite(previousClan, { ...previousClan, settlementReceipts: [{ transactionId: 'forged', fingerprint: 'forged' }] }, { callerName: 'auditmember', isAdmin: false }).next.settlementReceipts,
};
fs.writeFileSync(new URL('./clan-probe-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));

// Local QA only: real handlers and isolated, disposable in-memory saves.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
delete process.env.ADMIN_PASSWORD;
process.env.SESSION_SECRET = 'sunscar-local-qa-session-only';
const { randomUUID } = await import('node:crypto');
const { fileURLToPath } = await import('node:url');
const { kv } = await import('../api/_storage.js');
const { issuePlayerToken } = await import('../api/_auth.js');
const { createExchangeListing } = await import('../api/festival/_exchange.js');
const { createOwnedPet } = await import('../api/pet/_owned-pet.js');
const { PET_CATALOG } = await import('../api/pet/_catalog.js');
const { loadSettlementCatalogs } = await import('../api/shop/_catalog.js');
const { default: exchangeModule } = await import('../api/festival/exchange.js');
const handler = typeof exchangeModule === 'function' ? exchangeModule : (exchangeModule as any).default;
const catalogs = await loadSettlementCatalogs();
const namedId = 'named-weapon-123456781234123412341234567890ab';
const namedArmorId = 'named-armor-123456781234123412341234567890ab';
const named = { id: namedId, name: 'Dawnreaver, the Last Ember', slot: 'hand', rarity: 'legendary', cost: 0, levelReq: 90, weaponEp: 31, weaponRange: 2, weaponCooldown: 5, weaponTags: [{ name: 'Bleed', percent: 24 }], bonuses: { bukijutsuOffense: 71, ninjutsuOffense: 62 }, description: 'The smith folded the steel through the last light of a dying sun. Its edge has never cooled.' };
const armor = { id: namedArmorId, name: 'Mantle of the Silent Dune', slot: 'body', rarity: 'legendary', cost: 0, levelReq: 90, armorQuality: 'Exquisite', bonuses: { defense: 75 }, description: 'A master-forged mantle, its dark plates threaded with desert gold.' };
const regularWeapon = [...catalogs.items.values()].find(i => i.slot === 'hand' && i.rarity === 'legendary') ?? [...catalogs.items.values()].find(i => i.slot === 'hand')!;
const regularArmor = [...catalogs.items.values()].find(i => ['armor', 'body'].includes(i.slot) && i.rarity === 'epic') ?? [...catalogs.items.values()].find(i => ['armor', 'body'].includes(i.slot))!;
const templateId = Object.keys(PET_CATALOG).find(id => PET_CATALOG[id].rarity === 'legendary' && !id.startsWith('starter-'))!;
const pet = createOwnedPet(templateId, { origin: 'bred', generation: 2 });
const char = (name: string) => ({ name, level: 100, ryo: 1_250_000, inventory: [], itemStacks: [], pets: [], tileCards: [], equipment: {}, boneCharms: 600, fateShards: 350, auraStones: 40, honorSeals: 150, mythicSeals: 10 });
async function resetQa() {
for (const key of await kv.keys('sunscar-exchange:*')) await kv.del(key);
for (const key of await kv.keys('ratelimit:sunscar-exchange:*')) await kv.del(key);
await kv.set('save:kaito', { _saveVersion: 1, character: { ...char('Kaito'), inventory: [regularWeapon.id, regularArmor.id, 'hunt-ancient-beast-core'], itemStacks: [{ itemId: 'hunt-torn-hide', count: 20 }] } });
await kv.set('save:amaya', { _saveVersion: 1, character: { ...char('Amaya'), inventory: [namedId, regularWeapon.id], pets: [pet] }, creatorItems: [named] });
await kv.set('save:ren', { _saveVersion: 1, character: { ...char('Ren'), inventory: [namedArmorId, regularArmor.id], itemStacks: [{ itemId: 'hunt-torn-hide', count: 20 }] }, creatorItems: [armor] });
for (const row of [
    ['amaya', 'item', namedId, 1, 425000], ['amaya', 'pet', pet.id, 1, 180000],
    ['ren', 'item', namedArmorId, 1, 320000], ['amaya', 'item', regularWeapon.id, 1, 76000],
    ['ren', 'item', regularArmor.id, 1, 24000], ['ren', 'item', 'hunt-torn-hide', 12, 2400],
    ['ren', 'resource', 'fateShards', 30, 9000],
] as const) await createExchangeListing(row[0], { requestId: randomUUID(), kind: row[1], assetId: String(row[2]), quantity: row[3], price: row[4] });

}
await resetQa();
const { default: express } = await import('express');
const app = express();
app.use(express.json());
app.post('/__qa/reset', async (_req, res) => { await resetQa(); res.send('reset'); });
app.get('/__qa/session', (_req, res) => res.json({ name: 'Kaito', token: issuePlayerToken('Kaito') }));
app.post('/api/festival/exchange', async (req, res) => {
    await handler(req as never, res as never);
});
app.use(express.static(fileURLToPath(new URL('../.tmp/sunscar-qa-dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../shinobij.client/public/', import.meta.url))));
app.listen(5198, '127.0.0.1', () => console.log('Sunscar Exchange QA: http://127.0.0.1:5198/sunscar-exchange-qa.html'));

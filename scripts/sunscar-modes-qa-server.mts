// Isolated local QA: production handlers against disposable memory saves.
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'sunscar-modes-local-browser-only';
delete process.env.ADMIN_PASSWORD;
const { fileURLToPath } = await import('node:url');
const { kv } = await import('../api/_storage.js');
const { issuePlayerToken } = await import('../api/_auth.js');
const { createOwnedPet } = await import('../api/pet/_owned-pet.js');
const { default: express } = await import('express');
const app = express();
app.use(express.json());
const name = 'sunscar-qa';
async function reset() {
    for (const key of await kv.keys('*')) await kv.del(key);
    const pets = ['starter-fire', 'standard-0', 'standard-3', 'rare-26', 'legendary-7', 'legendary-9', 'standard-1'].map(id => createOwnedPet(id, { origin: id.startsWith('starter-') ? 'starter' : 'wild' }));
    await kv.set('save:' + name, { _saveVersion: 1, _saveAt: Date.now(), _regenAt: Date.now(), creatorItems: [], creatorJutsus: [], character: {
        name, nickname: 'Kaito', level: 30, village: 'Ashen Leaf Village', element: 'Fire', ryo: 25000, hp: 820, maxHp: 1000, chakra: 86, maxChakra: 100, stamina: 94, maxStamina: 100,
        stats: { strength: 70, intelligence: 70, agility: 70, defense: 70 }, equipment: {}, inventory: [], itemStacks: [], tileCards: [], pets, activePetId: pets[0].id, jutsus: [],
    } });
}
await reset();
app.get('/__qa/session', (_req, res) => res.json({ name, token: issuePlayerToken(name) }));
app.post('/__qa/reset', async (_req, res) => { await reset(); res.json({ ok: true }); });
app.post('/__qa/encounter', async (req, res) => {
    const { caravanEvent } = await import('../shared/sunscar/caravan-events.js');
    const event = caravanEvent(String(req.body.eventId));
    const save = await kv.get<any>('save:' + name), run = save?.character.sunscarCaravan?.current;
    if (!run || run.result) { res.status(409).json({ error: 'Start an expedition first.' }); return; }
    const node = run.map.find((n: any) => n.id === run.available[0]) ?? run.map[0];
    node.eventId = event.id; node.kind = event.kind; node.revealed = true;
    run.currentNodeId = node.id; run.visited = [node.id]; run.status = 'encounter'; run.available = []; run.version++;
    save._saveVersion++; await kv.set('save:' + name, save); res.json({ ok: true });
});
// Controlled initial positions for browser coverage of the real combat actions
// and settlement. This standalone memory server is never a production route.
app.post('/__qa/combat-fixture', async (req, res) => {
    const save = await kv.get<any>('save:' + name);
    const id = save?.character.sunscarCaravan?.current?.combat?.sessionId;
    const { readSoloPveSession, writeSoloPveSession } = await import('../api/solo-pve/_store.js');
    const session = id ? await readSoloPveSession(id) : null;
    if (!session || session.outcome) { res.status(409).json({ error: 'Open a battle first.' }); return; }
    session.player.pos = 62; session.enemy.pos = 63;
    if (req.body.scenario === 'victory') { session.enemy.hp = 1; session.enemy.shield = 0; }
    else if (req.body.scenario === 'defeat') { session.player.hp = 1; session.player.shield = 0; }
    else { res.status(400).json({ error: 'Choose a fixture.' }); return; }
    await writeSoloPveSession(session);
    res.json({ ok: true });
});
for (const [path, source] of [
    ['/festival/rally', '../api/festival/rally.js'], ['/festival/caravan', '../api/festival/caravan.js'], ['/festival/exchange', '../api/festival/exchange.js'],
    ['/pet/encounter-start', '../api/pet/encounter-start.js'], ['/pet/befriend', '../api/pet/befriend.js'], ['/pet/encounter-decline', '../api/pet/encounter-decline.js'],
    ['/solo-pve/state', '../api/solo-pve/state.js'], ['/solo-pve/action', '../api/solo-pve/action.js'], ['/pve/fight-outcome', '../api/pve/fight-outcome.js'],
] as const) {
    const module = await import(source), handler = typeof module.default === 'function' ? module.default : module.default.default;
    app.all('/api' + path, async (req, res) => { await handler(req as never, res as never); });
}
app.use(express.static(fileURLToPath(new URL('../.tmp/sunscar-modes-qa-dist/', import.meta.url))));
app.use(express.static(fileURLToPath(new URL('../shinobij.client/public/', import.meta.url))));
app.listen(5199, '127.0.0.1', () => console.log('Sunscar modes QA: http://127.0.0.1:5199/sunscar-modes-qa.html'));

// IPC-only fixture for the real-Postgres integration gate. Never a public route.
import { createServer } from 'node:http';

const database = new URL(process.env.DATABASE_URL ?? '');
if (!process.send || process.env.SHINOBIX_QA_DISPOSABLE_PG !== '1'
    || !['127.0.0.1', 'localhost'].includes(database.hostname)
    || !/^\/pgit_world_boss_[a-f0-9]+$/.test(database.pathname)) throw new Error('A newly allocated local world-boss test database is required.');
delete process.env.SHINOBIX_QA_MEMORY_KV;
const { kv, closeStoragePool } = await import('../api/_storage.js');
const events = await import('../api/world-boss-event/_event.js');
const tower = await import('../api/towers/_tower-store.js');
const { withKvLock } = await import('../api/_lock.js');
const { issuePlayerToken } = await import('../api/_auth.js');
const handlers = new Map(await Promise.all([
    ['/api/world-boss-event', '../api/world-boss-event.js'],
    ['/api/world-boss-event/queue', '../api/world-boss-event/queue.js'],
    ['/api/world-boss-event/settle', '../api/world-boss-event/settle.js'],
    ['/api/towers/action', '../api/towers/action.js'],
    ['/api/towers/state', '../api/towers/state.js'],
].map(async ([path, module]) => [path, (await import(module)).default])));

let gate;
const compareSet = kv.compareSet.bind(kv);
kv.compareSet = async (...args) => {
    if (gate && args[0] === gate.key && args[2]?.status === gate.status) {
        const current = gate;
        current.arrived = true;
        current.enter?.();
        await current.released;
    }
    return compareSet(...args);
};
const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const handler = handlers.get(url.pathname);
    if (!handler) { res.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    req.body = raw ? JSON.parse(raw) : {};
    req.query = Object.fromEntries(url.searchParams);
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
    try { await handler(req, res); }
    catch (error) { res.status(500).json({ error: String(error) }); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ ready: true, port: server.address().port });
process.on('message', async ({ id, command, input = {} }) => {
    try {
        let value;
        if (command === 'token') value = issuePlayerToken(input.slug);
        else if (command === 'pointer') await events.writeWorldBossPlayerPointer(input.eventId, input.slug, input.pointer);
        else if (command === 'holdPointer') {
            let release;
            gate = { key: events.worldBossPlayerKey(input.eventId, input.slug), status: input.status, arrived: false,
                released: new Promise(resolve => { release = resolve; }), release: () => release() };
        } else if (command === 'entered') {
            if (!gate) throw new Error('No pointer gate armed.');
            if (!gate.arrived) await new Promise(resolve => { gate.enter = resolve; });
        } else if (command === 'release') { gate?.release(); gate = undefined; }
        else if (command === 'ageQueue') {
            await withKvLock(events.worldBossQueueKey(input.eventId), async () => {
                const queue = await events.readWorldBossQueue(input.eventId);
                for (const ticket of queue.tickets) ticket.joinedAt -= 31_000;
                await events.writeWorldBossQueue(input.eventId, queue);
            }, { failClosed: true });
        } else if (command === 'prepare' || command === 'done') {
            await withKvLock(`tower:${input.runId}`, async () => {
                const session = await tower.readSession(input.runId);
                if (!session?.worldBossEvent) throw new Error('Expected a sealed world boss session.');
                if (command === 'done') { session.status = 'done'; session.winner = 'enemy'; }
                else {
                    const humans = session.actors.filter(actor => actor.side === 'squad' && !actor.ai);
                    const player = humans.find(actor => actor.ownerSlug === input.slug);
                    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId);
                    for (const actor of session.actors) if (actor.side === 'enemy' && actor.id !== boss.id) actor.hp = 0;
                    for (const actor of humans) { actor.hp = actor.maxHp = 1_000_000; actor.shield = 0; actor.character.hp = actor.character.maxHp = 1_000_000; actor.pos = session.map.width * session.map.height - 1; }
                    player.pos = 20; boss.pos = 21; boss.hp = 10_000; boss.shield = 0; boss.statuses = [];
                    // The AI correctly Clears a removable Reflect buff first.
                    // Equipment reflection survives Clear and exercises the real AI turn.
                    player.statuses = []; player.character.itemReflectPct = 30;
                    boss.character.jutsu = [{ id: 'pgit-boss-hit', name: 'Test boss hit', type: 'Taijutsu', target: 'OPPONENT', ap: 60, range: 4, effectPower: 2000, aiPriority: 100 }];
                    boss.character.jutsuMastery = [{ jutsuId: 'pgit-boss-hit', level: 50 }];
                    session.turnQueue = [player.id, boss.id, ...humans.filter(actor => actor !== player).map(actor => actor.id)];
                    session.activeIndex = 0; session.activeAp = 100; session.actionsThisTurn = 0; session.turnStartedAt = Date.now();
                    session.phaseState.pendingPhases = []; session.phaseState.triggeredPhases = [75, 50, 25]; delete session.towerTactics;
                }
                await tower.writeSession(session); value = session;
            }, { failClosed: true });
        } else throw new Error('Unknown fixture command.');
        process.send({ id, value });
    } catch (error) { process.send({ id, error: String(error) }); }
});
process.on('disconnect', async () => { gate?.release(); server.closeAllConnections(); server.close(); await closeStoragePool(); process.exit(0); });

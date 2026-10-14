/** Loopback-only QA server. Real production handlers, isolated memory storage and local signed test accounts. */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createServer } from '../shinobij.client/node_modules/vite/dist/node/index.js';

if (process.env.NODE_ENV === 'production') throw new Error('This harness cannot run in production.');
process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'loopback-pet-arena-qa-account-secret';
const { kv } = await import('../api/_storage.js');
const { issuePlayerToken } = await import('../api/_auth.js');
const { default: commands } = await import('../api/pet/tactics.js');
const { default: queue } = await import('../api/pvp/pet-ranked-queue.js');
const { default: settle } = await import('../api/pet/battle-result.js');
const { default: watch } = await import('../api/pet/ranked-watch.js');
const { default: showdown } = await import('../api/pet/showdown.js');
const { default: perfBeacon } = await import('../api/perf-beacon.js');
const { default: petProgress } = await import('../api/pet/progress.js');
const { PET_CATALOG } = await import('../api/pet/_catalog.js');
for (const name of ['alice', 'bob']) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 40, ryo: 500, petRankedRating: 1000,
    pets: ['standard-0', 'standard-1', 'standard-2', 'standard-3', 'standard-4'].map((id, i) => ({ ...PET_CATALOG[id], templateId: id, id: `ranked-${i}` })) } });
if (process.env.PET_YARD_CARE_QA === '1') {
    const now = Date.now();
    for (const name of ['alice', 'bob']) {
        const save = await kv.get<Record<string, unknown>>(`save:${name}`);
        const character = save!.character as { pets: Record<string, unknown>[] };
        await kv.set(`save:${name}`, { ...save, character: { ...character, inventory: ['pet-treat', 'pet-treat', 'collar-crimson', 'collar-prismatic'],
            pets: character.pets.map((pet, i) => ({ ...pet, level: 10, xp: 0, maxLevel: 100, happiness: 50,
                happinessDay: new Date(now).toISOString().slice(0, 10), happinessPets: 0,
                ...(i === 1 ? { paletteVariantId: 'chromatic' } : {}),
                ...(i === 0 && process.env.PET_RANKED_APPEARANCE_QA === '1' ? { loadout: { collar: name === 'alice' ? 'collar-prismatic' : 'collar-crimson' } } : {}),
                ...(i === 0 ? { training: { type: 'strength', startedAt: now - 700000, endsAt: now - 10000, durationMs: 600000, sealedXp: 100 } } : {}),
            })),
        } });
    }
}
const nativePets = ['standard-0', 'standard-1', 'standard-2', 'standard-3', 'standard-4'].map((templateId, index) => ({
    ...PET_CATALOG[templateId], templateId, id: `native-${index}`, level: 30, xp: 0, maxLevel: 100, unlockedForPve: true,
}));
await kv.set('save:native', { _saveVersion: 1, character: { name: 'native', level: 40, ryo: 500, pets: nativePets } });
for (const name of ['dungeondesktop', 'dungeonmobile']) await kv.set(`save:${name}`, { _saveVersion: 1, character: {
    name, level: 55, ryo: 500, pets: nativePets.map(pet => ({ ...pet, level: 55 })),
    activeDungeonRun: { token: `qadungeon${name}01`, startedAt: 1, entry: 'key', combatAuthorityVersion: 1,
        wardenDefeated: true, wardenProofId: 'wardenproof0001', cardAuthorityVersion: 1,
        cardLastOutcome: 'player', cardLastProofId: 'cardproof000001', cardSettledAt: 2,
        cardDefeated: true, cardProofId: 'cardproof000001', cardDefeatedAt: 2 },
} });
const app = express(); app.use(express.json({ limit: '32kb' }));
// The real telemetry sink is anonymous, including on standalone VFX pages.
app.post('/api/perf-beacon', (req, res) => void perfBeacon(req as never, res as never));
app.use('/api', (req, res, next) => {
    const name = req.headers['x-tactics-qa-player'];
    if (name !== 'alice' && name !== 'bob' && name !== 'native' && name !== 'dungeondesktop' && name !== 'dungeonmobile') { res.status(401).json({ error: 'A local QA seat is required.' }); return; }
    req.headers['x-player-token'] = issuePlayerToken(name)!; next();
});
app.post('/api/pet/tactics', (req, res) => void commands(req as never, res as never));
app.post('/api/pvp/pet-ranked-queue', (req, res) => void queue(req as never, res as never));
app.post('/api/pet/battle-result', (req, res) => void settle(req as never, res as never));
app.post('/api/pet/ranked-watch', (req, res) => void watch(req as never, res as never));
app.post('/api/pet/showdown', (req, res) => void showdown(req as never, res as never));
app.post('/api/pet/progress', (req, res) => void petProgress(req as never, res as never));
app.get('/api/pet/progress', (req, res) => void petProgress(req as never, res as never));
app.get('/api/save/:name', async (req, res) => {
    if (req.params.name !== req.headers['x-tactics-qa-player']) { res.status(403).end(); return; }
    res.json(await kv.get(`save:${req.params.name}`));
});
const port = Number(process.env.PET_TACTICS_QA_PORT ?? 4318);
const staticFixture = process.env.PET_TACTICS_QA_STATIC === '1';
const vite = staticFixture ? null : await createServer({ configFile: fileURLToPath(new URL('../shinobij.client/scripts/vite.pet-tactics-qa.config.mjs', import.meta.url)),
    cacheDir: fileURLToPath(new URL(`../shinobij.client/node_modules/.vite-pet-tactics-${port}`, import.meta.url)),
    server: { hmr: { host: '127.0.0.1', port: port + 20000 } } });
if (vite) app.use(vite.middlewares);
else {
    app.use(express.static(fileURLToPath(new URL('../output/pet-tactics-qa-dist', import.meta.url))));
    app.use(express.static(fileURLToPath(new URL('../shinobij.client/public', import.meta.url))));
}
const server = app.listen(port, '127.0.0.1', () => console.log(`Pet Arena QA: http://127.0.0.1:${port}/pet-tactics-qa.html?seat=alice&ranked=1`));
process.on('SIGTERM', () => { server.close(); void vite?.close(); });

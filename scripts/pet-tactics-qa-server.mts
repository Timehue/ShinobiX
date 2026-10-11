/** Loopback-only QA server. Real production handlers, isolated memory storage and local signed test accounts. */
import express from 'express';
import { fileURLToPath } from 'node:url';
import { createServer } from '../shinobij.client/node_modules/vite/dist/node/index.js';

if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('This harness cannot run in production.');
process.env.NODE_ENV = 'test'; process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'loopback-pet-arena-qa-account-secret';
const { kv } = await import('../api/_storage.js');
const { issuePlayerToken } = await import('../api/_auth.js');
const { default: commands } = await import('../api/pet/tactics.js');
const { default: queue } = await import('../api/pvp/pet-ranked-queue.js');
const { default: settle } = await import('../api/pet/battle-result.js');
const { default: watch } = await import('../api/pet/ranked-watch.js');
for (const name of ['alice', 'bob']) await kv.set(`save:${name}`, { _saveVersion: 1, character: { name, level: 40, ryo: 500, petRankedRating: 1000, pets: [] } });
const app = express(); app.use(express.json({ limit: '32kb' }));
app.use('/api', (req, res, next) => {
    const name = req.headers['x-tactics-qa-player'];
    if (name !== 'alice' && name !== 'bob') { res.status(401).json({ error: 'A local QA seat is required.' }); return; }
    req.headers['x-player-token'] = issuePlayerToken(name)!; next();
});
app.post('/api/pet/tactics', (req, res) => void commands(req as never, res as never));
app.post('/api/pvp/pet-ranked-queue', (req, res) => void queue(req as never, res as never));
app.post('/api/pet/battle-result', (req, res) => void settle(req as never, res as never));
app.post('/api/pet/ranked-watch', (req, res) => void watch(req as never, res as never));
app.get('/api/save/:name', async (req, res) => {
    if (req.params.name !== req.headers['x-tactics-qa-player']) { res.status(403).end(); return; }
    res.json(await kv.get(`save:${req.params.name}`));
});
const vite = await createServer({ configFile: fileURLToPath(new URL('../shinobij.client/scripts/vite.pet-tactics-qa.config.mjs', import.meta.url)) });
app.use(vite.middlewares);
const port = Number(process.env.PET_TACTICS_QA_PORT ?? 4318);
const server = app.listen(port, '127.0.0.1', () => console.log(`Pet Arena QA: http://127.0.0.1:${port}/pet-tactics-qa.html?seat=alice&ranked=1`));
process.on('SIGTERM', () => { server.close(); void vite.close(); });

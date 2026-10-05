// Local-only browser integration host. Uses production routes with isolated memory storage.
import express from 'express';
import { resolve } from 'node:path';
async function main() {
    if (process.env.NODE_ENV !== 'test' || process.env.SHINOBIX_QA_MEMORY_KV !== '1') throw new Error('Tournament QA requires isolated test storage.');
    const [{ registerApiRoutes }, { kv }, { issuePlayerToken }, tournamentStore, { PET_CATALOG }, { WORLD_GEO_VERSION }] = await Promise.all([
        import('../server-api-routes.js'), import('../api/_storage.js'), import('../api/_auth.js'),
        import('../api/tournaments/_store.js'), import('../api/pet/_catalog.js'), import('../shared/sector-geo.js'),
    ]);
    const realNow = Date.now.bind(Date);
    let offset = 0;
    Date.now = () => realNow() + offset;
    const app = express(); app.use(express.json());
    const names = ['akira', 'ren', 'sora', 'yuki'];
    for (const id of names) {
        const pet = { ...PET_CATALOG['standard-0'], id: `${id}-pet`, templateId: 'standard-0', name: `${id}'s companion`, level: 30 };
        await kv.set(`save:${id}`, { worldGeoV: WORLD_GEO_VERSION, currentSector: 12, currentTile: 65, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [], character: {
            name: id, village: 'Moonshadow Village', specialty: 'Ninjutsu', bloodline: 'None', level: 30, rankTitle: 'Chunin',
            hp: 1000, maxHp: 1000, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300,
            stats: Object.fromEntries(['strength', 'speed', 'intelligence', 'willpower', 'bukijutsuOffense', 'bukijutsuDefense',
                'taijutsuOffense', 'taijutsuDefense', 'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense'].map(key => [key, 100])),
            ryo: 1000, inventory: [], itemStacks: [], equipment: {}, pets: [pet], activePetIds: [pet.id],
            onboardingStep: 'done', academyChecklistClaimed: true, starterCardsClaimed: true, storyProgress: 99,
            examsPassed: ['genin', 'chunin'], profession: 'vanguard', professionRank: 1, professionXp: 0, professionChosenAt: 1,
            tileCards: [], jutsuMastery: [], equippedJutsuIds: [], jutsus: [],
        } });
    }
    app.get('/qa-tournament/player/:id', async (req, res) => {
        if (!names.includes(req.params.id)) { res.status(404).end(); return; }
        const save = await kv.get<{ character: unknown }>(`save:${req.params.id}`);
        res.json({ character: save!.character, canonical: save, token: issuePlayerToken(req.params.id) });
    });
    app.post('/qa-tournament/advance', async (req, res) => {
        offset += Math.max(0, Math.min(7200_000, Number(req.body.ms) || 0));
        await kv.del('game:tournaments:tick');
        await tournamentStore.tickTournaments();
        res.json({ event: await tournamentStore.readTournament() });
    });
    app.post('/qa-tournament/reset', async (_req, res) => {
        const event = await tournamentStore.readTournament();
        if (event) await tournamentStore.tournamentLock(() => tournamentStore.cancelTournament(event));
        for (const pattern of ['game:tournaments:*', 'tower-pvp:*', 'battle-lock:*']) {
            const keys = await kv.keys(pattern); if (keys.length) await kv.del(...keys);
        }
        offset += 60_001; // independent rate-limit windows between scenarios
        res.json({ ok: true });
    });
    registerApiRoutes((path, handler) => {
        app.all(`/api${path}`, (req, res, next) => {
            Object.defineProperty(req, 'query', { value: { ...req.query, ...req.params }, configurable: true });
            Promise.resolve(handler(req as never, res as never)).catch(next);
        });
    });
    app.get('/health', (_req, res) => res.json({ ok: true }));
    // Playwright runs this host from shinobij.client; serve its real production build for boot recovery.
    app.use(express.static(resolve('dist')));
    const server = app.listen(5198, '127.0.0.1');
    const stop = tournamentStore.startTournamentClock();
    server.on('close', stop);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

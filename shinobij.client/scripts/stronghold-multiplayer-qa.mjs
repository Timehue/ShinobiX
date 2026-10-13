import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import express from 'express';
import { build } from 'esbuild';
import { chromium, webkit } from '@playwright/test';
import pg from 'pg';

// Default to isolated memory. Postgres is supplied by the fresh-cluster helper;
// fail closed before writing if the loopback test database is not empty.
const postgres = process.argv.includes('--postgres');
let storageLabel = 'isolated-memory';
process.env.NODE_ENV = 'test';
if (postgres) {
    assert.equal(process.env.SHINOBIX_QA_DISPOSABLE_PG, '1', 'Use scripts/test-with-postgres.mjs --stronghold-multiplayer.');
    const testUrl = process.env.PG_INTEGRATION_DATABASE_URL;
    assert(testUrl, 'The helper must supply its fresh database URL.');
    assert.equal(new URL(testUrl).hostname, '127.0.0.1', 'Only the helper’s loopback database is permitted.');
    const database = new pg.Client({ connectionString: testUrl, ssl: false, connectionTimeoutMillis: 10000 });
    try {
        await database.connect();
        assert.equal((await database.query('SELECT count(*)::int AS n FROM public.kv_store')).rows[0].n, 0, 'Refusing a non-empty test database.');
        storageLabel = `isolated-PostgreSQL ${(await database.query('SHOW server_version')).rows[0].server_version}`;
    } finally { await database.end(); }
    process.env.DATABASE_URL = testUrl; process.env.PG_SSL = 'disable'; delete process.env.SHINOBIX_QA_MEMORY_KV;
} else {
    process.env.SHINOBIX_QA_MEMORY_KV = '1';
}
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
const { kv, saveStoreKind, closeStoragePool } = await import('../../api/_storage.ts'); assert.equal(saveStoreKind, postgres ? 'base-store' : 'memory-qa');
const { onlineStore } = await import('../../api/_realtime/online-store.ts');
const { issuePlayerToken } = await import('../../api/_auth.ts');
const { strongholdVisitKey } = await import('../../api/village/_stronghold.ts');
const { homeVillageForSector } = await import('../../api/_war-map-sectors.ts');
const { buildStrongholdTiles, STRONGHOLD_DIMS } = await import('../../shared/sector-stronghold.ts');
const { __resetRateLimitsForTest: resetLimits } = await import('../../api/_ratelimit.ts');
const output = resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? '.tmp/stronghold-multiplayer');
const bundle = resolve('.tmp/stronghold-multiplayer-bundle'); await mkdir(output, { recursive: true }); await mkdir(bundle, { recursive: true });
await build({ entryPoints: ['scripts/fixtures/underground-sector-qa.tsx'], bundle: true, jsx: 'automatic', outfile: bundle + '/preview.js',
    plugins: [{ name: 'public-assets', setup(b) { b.onResolve({ filter: /^\// }, args => ({ path: args.path, external: true })); } }],
    loader: { '.css': 'css', '.png': 'file', '.webp': 'file', '.svg': 'file', '.woff2': 'file', '.woff': 'file', '.jpg': 'file' },
    define: { 'import.meta.env.PROD': 'false', 'import.meta.env.DEV': 'true', 'import.meta.env.MODE': '"test"' }, logLevel: 'error' });
const app = express(); app.use(express.json());
let responseDelay = 120;
for (const [path, source] of [['village/anbu-infiltration', 'village/anbu-infiltration'], ['player/attack', 'player/attack'], ['pvp/session', 'pvp/session'], ['pvp/move', 'pvp/move'], ['pvp/claim-rewards', 'pvp/claim-rewards']]) {
    const { default: handler } = await import(`../../api/${source}.ts`);
    app.post(`/api/${path}`, async (req, res) => { if (path === 'village/anbu-infiltration') await new Promise(r => setTimeout(r, responseDelay)); await handler(req, res); });
}
app.get('/', (_req, res) => res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/preview.css"><style>html,body,#root{margin:0;min-height:100%;background:#080d14}body{padding:0}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>'));
app.use(express.static(bundle)); app.use(express.static(resolve('public')));
const server = createServer(app); await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`, errors = [], checks = [], metrics = [], loadSamples = [];
function monitor(page) { page.on('pageerror', e => errors.push(String(e))); }
async function post(page, path, body) { return page.evaluate(async ({ path, body }) => { const response = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; }, { path, body }); }
async function seed(name, sector, village) {
    const character = { name, level: 50, village, avatarImage: '/anbu/frostfang.webp', hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], jutsu: [], equippedJutsuIds: ['starter-universal-flicker'], jutsuMastery: [{ jutsuId: 'starter-universal-flicker', level: 1, xp: 0 }] };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: sector, character }); onlineStore.upsert({ name, sector, character }); return character;
}
try {
    for (const [engineName, engine] of [['chromium', chromium], ['webkit', webkit]]) {
        const browser = await engine.launch({ headless: true });
        try {
            for (const sector of [12, 99]) {
                resetLimits(); const one = `mp${engineName}${sector}alpha`, two = `mp${engineName}${sector}beta`, outsider = `mp${engineName}${sector}out`;
                const defenderVillage = homeVillageForSector(sector) ?? 'Frostfang Village';
                const p1Character = await seed(one, sector, 'Moonshadow Village'), p2Character = await seed(two, sector, defenderVillage); await seed(outsider, sector, 'Ashen Leaf Village');
                const contexts = await Promise.all([one, two].map((name, i) => browser.newContext({ viewport: i ? { width: 390, height: 844 } : { width: 320, height: 568 }, hasTouch: true, reducedMotion: 'no-preference', extraHTTPHeaders: { 'x-player-name': name, 'x-player-token': issuePlayerToken(name) } })));
                const pages = await Promise.all(contexts.map(c => c.newPage())); pages.forEach(monitor); const [alpha, beta] = pages;
                const url = name => `${base}/?mode=stronghold&multiplayer&level=50&sector=${sector}&name=${name}&targetVillage=${encodeURIComponent(defenderVillage)}&village=${encodeURIComponent(name === one ? 'Moonshadow Village' : defenderVillage)}`;
                await Promise.all([alpha.goto(url(one)), beta.goto(url(two))]);
                await alpha.getByRole('button', { name: `Inspect ${two}`, exact: true }).waitFor(); await beta.getByRole('button', { name: `Inspect ${one}`, exact: true }).waitFor();
                assert.equal(await alpha.getByRole('button', { name: `Inspect ${outsider}`, exact: true }).count(), 0, 'exterior peers stay outside');
                assert.equal(await alpha.locator('.stronghold-decoration').count(), 0, 'legacy door overlays are removed');
                for (const page of pages) {
                    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
                    for (const button of await page.getByRole('button', { name: /^Move / }).all()) { const r = await button.boundingBox(); assert(r.width >= 44 && r.height >= 44); }
                }
                await alpha.bringToFront();
                if (engineName === 'chromium') await (await contexts[0].newCDPSession(alpha)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
                const sample = alpha.evaluate(() => new Promise(resolve => { const times = [], start = performance.now(); let previous = start; function frame(now) { times.push(now - previous); previous = now; if (now - start < 2500) requestAnimationFrame(frame); else { times.sort((a,b) => a-b); resolve({ frames: times.length, p95Ms: times[Math.floor(times.length * .95)], longestMs: times.at(-1) }); } } requestAnimationFrame(frame); }));
                const initial = await kv.get(strongholdVisitKey(one, sector));
                await alpha.getByRole('button', { name: 'Move right', exact: true }).click();
                await beta.waitForFunction(tile => Number(document.querySelector('.stronghold-peer')?.dataset.tile) === tile, initial.tile + 1).catch(async () => {
                    await beta.waitForFunction(() => { const peer = document.querySelector('.stronghold-peer'), player = document.querySelector('.stronghold-player'); return peer && player && parseFloat(peer.style.left) > parseFloat(player.style.left); });
                });
                const moved = await kv.get(strongholdVisitKey(one, sector)); assert.equal(moved.tile, initial.tile + 1); assert.equal(moved.threat, 4);
                const frameMetric = await sample; metrics.push({ engine: engineName, sector, cpuSlowdown: engineName === 'chromium' ? 4 : 1, responseDelay, ...frameMetric }); assert(frameMetric.p95Ms < 85, 'mobile frame pacing stays usable under local CPU/latency simulation');
                const blocked = buildStrongholdTiles(sector).findIndex(t => t.solid);
                const rejected = await post(alpha, 'village/anbu-infiltration', { action: 'stronghold-step', playerName: one, sector, presenceId: moved.presenceId, version: moved.version, tile: blocked });
                assert.equal(rejected.status, 409); assert.equal((await kv.get(strongholdVisitKey(one, sector))).threat, 4);
                const oldBeta = await kv.get(strongholdVisitKey(two, sector)); await beta.getByRole('button', { name: 'Leave stronghold' }).click();
                await alpha.getByRole('button', { name: `Inspect ${two}`, exact: true }).waitFor({ state: 'hidden' }); await beta.goto(url(two));
                await alpha.getByRole('button', { name: `Inspect ${two}`, exact: true }).waitFor();
                const staleLease = await post(beta, 'village/anbu-infiltration', { action: 'stronghold-state', playerName: two, sector, presenceId: oldBeta.presenceId }); assert.equal(staleLease.status, 409);
                await contexts[1].setOffline(true); await new Promise(r => setTimeout(r, 2400)); await contexts[1].setOffline(false);
                await beta.getByRole('button', { name: `Inspect ${one}`, exact: true }).waitFor();
                assert.equal((await kv.get(strongholdVisitKey(one, sector))).threat, 4, 'peer reconnect cannot change another player’s threat');
                await alpha.screenshot({ path: `${output}/${engineName}-${sector}-two-player-phone.png` });
                await alpha.getByRole('button', { name: `Inspect ${two}`, exact: true }).click(); await alpha.getByRole('button', { name: 'Attack player', exact: true }).click();
                await alpha.waitForFunction(() => document.body.dataset.attack === 'true');
                const made = await post(alpha, 'pvp/session', { playerName: one, battleId: `physical${engineName}${sector}000000000000`, p1Character, p2Character, baseRewards: true, rewardSector: sector, useCurrentVitals: true, requireWorldCoLocation: true });
                assert.equal(made.status, 200, JSON.stringify(made.body)); assert.equal(made.body.session.rewardAuthority, 'world');
                const battleId = made.body.session.battleId;
                assert.equal(made.body.session.rewardStronghold, sector === 99 ? 'deathsgate' : undefined);
                for (const [page, name, role] of [[alpha, one, 'p1'], [beta, two, 'p2']]) { const joined = await post(page, 'pvp/move', { playerName: name, battleId, role, action: 'join', moveToken: `join-${role}` }); assert.equal(joined.status, 200, JSON.stringify(joined.body)); }
                const visit = await kv.get(strongholdVisitKey(one, sector)); const duringFight = await post(alpha, 'village/anbu-infiltration', { action: 'stronghold-step', playerName: one, sector, presenceId: visit.presenceId, version: visit.version, tile: visit.tile + 1 });
                assert(duringFight.status !== 200 || duringFight.body.combatBlocked); assert.equal((await kv.get(strongholdVisitKey(one, sector))).tile, visit.tile);
                // Deterministic combat board, as in the backend integration suite;
                // admission, both joins, KO and rewards still use actual handlers.
                const live = await kv.get(`pvp:${battleId}`); await kv.set(`pvp:${battleId}`, { ...live, activePlayer: 'p1', roundOpener: 'p1', p1: { ...live.p1, pos: 61 }, p2: { ...live.p2, pos: 62, hp: 1 } });
                const ko = await post(alpha, 'pvp/move', { playerName: one, battleId, role: 'p1', action: 'basicAttack', moveToken: 'physical-ko' }); assert.equal(ko.body.status, 'done', JSON.stringify(ko.body));
                const paid = await post(alpha, 'pvp/claim-rewards', { playerName: one, battleId, outcome: 'win', completionVersion: 1 }); assert.equal(paid.status, 200, JSON.stringify(paid.body)); assert.equal(paid.body.base.reward.ryo, sector === 99 ? 300 : 75);
                const before = await kv.get(`save:${one}`); const replay = await post(alpha, 'pvp/claim-rewards', { playerName: one, battleId, outcome: 'win', completionVersion: 1 }); assert.equal(replay.status, 200); assert.equal((await kv.get(`save:${one}`)).character.ryo, before.character.ryo);
                checks.push({ engine: engineName, sector, playerLevel: 50, defenderVillage, twoAuthenticatedBrowsers: true, livePeerMovement: true, exteriorIsolation: true, collisionRejected: true, leaveReconnect: true, offlineRecovery: true, staleLeaseRejected: true, battleAdmission: true, bothJoins: true, combatMovementBlocked: true, koAndRewards: true, rewardReplay: true });
                await Promise.all(contexts.map(c => c.close())); onlineStore.remove(one); onlineStore.remove(two); onlineStore.remove(outsider);
            }
        } finally { await browser.close(); }
    }
    for (const sector of [12, 99]) {
        resetLimits(); const names = Array.from({ length: 24 }, (_, i) => `mpcrowd${sector}p${i}`), durations = [];
        await Promise.all(names.map(name => seed(name, sector, 'Moonshadow Village')));
        const visits = new Map();
        const request = async (name, index, action, fields = {}) => {
            const start = performance.now();
            const response = await fetch(base + '/api/village/anbu-infiltration', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-player-name': name, 'x-player-token': issuePlayerToken(name), 'x-forwarded-for': `10.92.${sector}.${index + 1}` }, body: JSON.stringify({ playerName: name, sector, action: `stronghold-${action}`, presenceId: `crowd-tab-${name}`, ...fields }) });
            const body = await response.json(); durations.push(performance.now() - start); assert.equal(response.status, 200, JSON.stringify(body)); return body;
        };
        await Promise.all(names.map(async (name, index) => visits.set(name, (await request(name, index, 'enter')).visit)));
        for (let step = 0; step < 6; step++) await Promise.all(names.map(async (name, index) => { const previous = visits.get(name); const next = await request(name, index, 'step', { tile: previous.tile + (step % 2 ? -1 : 1), version: previous.version }); assert.equal(next.visit.threat, (step + 1) * 4); assert.equal(next.visit.steps, step + 1); visits.set(name, next.visit); }));
        for (const [index, name] of names.entries()) { const state = await request(name, index, 'state'); assert.equal(state.peers.length, 23); assert.equal(state.visit.threat, 24); }
        durations.sort((a,b) => a-b); const sample = { sector, playerLevel: 50, players: names.length, stepsPerPlayer: 6, requests: durations.length, responseDelay, p95Ms: durations[Math.floor(durations.length * .95)], longestMs: durations.at(-1) }; loadSamples.push(sample); assert(sample.p95Ms < 1500, 'local concurrent-player handler latency remains bounded');
        await Promise.all(names.map((name, index) => request(name, index, 'leave'))); names.forEach(name => onlineStore.remove(name));
    }
    assert.deepEqual(errors, []); await writeFile(output + '/results.json', JSON.stringify({ checks, metrics, loadSamples, errors, storage: storageLabel, handlers: 'actual-authenticated-http', simulatedLatencyMs: responseDelay }, null, 2));
    console.log(`Four authenticated two-browser stronghold scenarios passed: ${output}`);
} finally { await new Promise(r => server.close(r)); await closeStoragePool(); }

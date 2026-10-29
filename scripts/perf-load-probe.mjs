// Load-performance probe: boots dist/server.js on the in-memory QA store and
// measures (a) a cold guest landing, (b) the same under 4x CPU + Fast-3G,
// (c) a logged-in refresh/restore, using the app's own perf beacon milestones.
// Usage (after `npm run build`):
//   node scripts/perf-load-probe.mjs [--runs=3] [--skipLanding] [--warm=1] [--idle=30000] [--out=file.json]
//   node scripts/perf-load-probe.mjs --prod=https://shinobijourney.com   (live landing only, read-only GETs)
// Writes a JSON file with per-run resource timelines, layout-shift sources and the perf beacon.
// Local numbers are pessimistic for phones: this server is HTTP/1.1 with no service worker.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const clientRoot = path.join(repoRoot, 'shinobij.client');
const require = createRequire(path.join(clientRoot, 'package.json'));
const { chromium } = require('@playwright/test');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true]; }));
const RUNS = Number(args.runs ?? 3);
const PORT = Number(args.port ?? 17997);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'perf-probe-admin';
const STATIC_DIR = args.static ? path.resolve(repoRoot, args.static) : undefined;

function startServer() {
    const env = {
        ...process.env,
        NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', PORT: String(PORT),
        SESSION_SECRET: 'perf-probe-session-secret-32-bytes-minimum-xx', ADMIN_PASSWORD: ADMIN,
        DISABLE_SCHEDULED_JOBS: '1', DISABLE_REALTIME: '1', DISABLE_SNAPSHOT_CRON: '1', SENTRY_DSN: '',
        ...(STATIC_DIR ? { STATIC_DIR } : {}),
    };
    const child = spawn(process.execPath, [path.join(repoRoot, 'dist', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    return { child, log: () => log };
}

async function waitHealthy(timeoutMs = 60_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error('server never became healthy');
}

const INIT = () => {
    window.__probe = { longTasks: [], lcp: 0, fcp: 0, cls: 0 };
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__probe.longTasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true }); } catch {}
    try { new PerformanceObserver(l => { const es = l.getEntries(); const last = es[es.length - 1]; if (last) window.__probe.lcp = Math.round(last.renderTime || last.loadTime || last.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__probe.fcp = Math.round(e.startTime); }).observe({ type: 'paint', buffered: true }); } catch {}
    window.__probe.shifts = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__probe.cls += e.value; const src = (e.sources || []).slice(0, 3).map(s => { const n = s.node; return n ? `${n.tagName || n.nodeName}${n.id ? '#' + n.id : ''}${n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 3).join('.') : ''}` : '?'; }); window.__probe.shifts.push({ t: Math.round(e.startTime), v: Number(e.value.toFixed(3)), src }); } }).observe({ type: 'layout-shift', buffered: true }); } catch {}
};

const COLLECT = () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource').map(e => ({
        url: e.name.replace(location.origin, ''), type: e.initiatorType, size: e.transferSize, enc: e.encodedBodySize, dec: e.decodedBodySize,
        start: Math.round(e.startTime), end: Math.round(e.responseEnd), dur: Math.round(e.responseEnd - e.startTime),
    }));
    const by = {};
    for (const r of res) {
        const k = /\.js(\?|$)/.test(r.url) ? 'js' : /\.css(\?|$)/.test(r.url) ? 'css' : /\.(woff2?|ttf)(\?|$)/.test(r.url) ? 'font' : r.url.startsWith('/api/') ? 'api' : /\.(png|webp|jpe?g|svg|gif|avif)(\?|$)/.test(r.url) ? 'img' : 'other';
        by[k] ??= { n: 0, bytes: 0 }; by[k].n++; by[k].bytes += r.size;
    }
    const lt = window.__probe.longTasks;
    const tbt = lt.reduce((a, t) => a + Math.max(0, t.d - 50), 0);
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    const screen = document.querySelector('.app-shell[data-screen]')?.getAttribute('data-screen') ?? null;
    const r = (v) => Math.round(v ?? 0);
    return {
        ttfb: Math.round(nav?.responseStart ?? 0), dcl: Math.round(nav?.domContentLoadedEventEnd ?? 0), load: Math.round(nav?.loadEventEnd ?? 0),
        // Where a slow document response went: DNS, TCP, TLS, or waiting on the server/CDN.
        navBreakdown: nav ? { dns: [r(nav.domainLookupStart), r(nav.domainLookupEnd)], connect: [r(nav.connectStart), r(nav.connectEnd)], tls: r(nav.secureConnectionStart), request: r(nav.requestStart), response: [r(nav.responseStart), r(nav.responseEnd)], protocol: nav.nextHopProtocol } : null,
        htmlBytes: nav?.transferSize ?? 0, fcp: window.__probe.fcp, lcp: window.__probe.lcp, cls: Number(window.__probe.cls.toFixed(3)),
        longTasks: lt.length, longTaskMax: Math.max(0, ...lt.map(t => t.d)), tbt: Math.round(tbt), heapMB: mem, screen,
        shifts: [...window.__probe.shifts].sort((a, b) => b.v - a.v).slice(0, 8), longTasksList: lt.slice(0, 20),
        totalBytes: res.reduce((a, r) => a + r.size, 0) + (nav?.transferSize ?? 0), byType: by, resources: res,
    };
};

async function newPage(browser, { mobile = false, throttle = false } = {}) {
    const context = await browser.newContext({
        viewport: mobile ? { width: 390, height: 844 } : { width: 1366, height: 768 },
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 1,
        serviceWorkers: 'block',
    });
    const page = await context.newPage();
    await page.addInitScript(INIT);
    const cdp = await context.newCDPSession(page);
    if (throttle) {
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 750 * 1024 / 8 });
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    }
    return { context, page, cdp };
}

async function landing(browser, opts) {
    const { context, page } = await newPage(browser, opts);
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    // Wait for the landing to actually render (StartScreen is lazy).
    await page.waitForSelector('.app-shell[data-screen], [data-screen]', { timeout: 60_000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const m = await page.evaluate(COLLECT);
    m.wall = Date.now() - t0;
    await context.close();
    return m;
}

async function seedAccount(name) {
    const reg = await fetch(`${BASE}/api/player-auth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'register', name, password: 'PerfProbe!1234' }) });
    if (!reg.ok) throw new Error(`register ${reg.status} ${await reg.text()}`);
    const { token } = await reg.json();
    const character = {
        name, village: 'Ember', specialty: 'Ninjutsu', bloodline: 'None', level: 12, rankTitle: 'Genin', xp: 0, ryo: 5000, unspentStats: 0,
        stats: { strength: 30, speed: 30, intelligence: 30, willpower: 30, bukijutsuOffense: 30, bukijutsuDefense: 30, taijutsuOffense: 30, taijutsuDefense: 30, genjutsuOffense: 30, genjutsuDefense: 30, ninjutsuOffense: 30, ninjutsuDefense: 30 },
        hp: 400, maxHp: 400, chakra: 400, maxChakra: 400, stamina: 400, maxStamina: 400,
        onboardingStep: 'done', inventory: ['rustfang-kunai', 'shinobi-vest'], itemStacks: [], equipment: {}, pets: [],
        jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [], dailyMissionsCompleted: 0,
    };
    let seeded;
    for (let i = 0; i < 3; i++) {
        seeded = await fetch(`${BASE}/api/save/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': ADMIN }, body: JSON.stringify({ character, currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [] }) });
        if (seeded.status !== 429) break;
        await new Promise(r => setTimeout(r, 3200));
    }
    if (!seeded.ok) throw new Error(`seed ${seeded.status} ${await seeded.text()}`);
    return { name, token };
}

async function restore(browser, account, opts) {
    const { context, page } = await newPage(browser, opts);
    await page.addInitScript(({ player, token }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: player }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [player]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', player);
        localStorage.setItem('shinobix:activeTokenPersist', token);
    }, { player: account.name, token: account.token });
    let beacon = null;
    await page.route('**/api/perf-beacon', async (r) => { try { beacon = JSON.parse(r.request().postData() ?? 'null'); } catch {} await r.fulfill({ status: 204, body: '' }); });
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'load' });
    // Playable = a non-shell screen committed.
    const playableAt = await page.waitForFunction(() => {
        const s = document.querySelector('.app-shell[data-screen]')?.getAttribute('data-screen');
        return s && s !== 'start' && s !== 'createCharacter' ? performance.now() : false;
    }, null, { timeout: 90_000 }).then(h => h.jsonValue()).catch(() => null);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await page.waitForTimeout(3500); // let the perf beacon settle (2.5s)
    const m = await page.evaluate(COLLECT);
    m.playableAt = playableAt ? Math.round(playableAt) : null;
    m.beacon = beacon;
    m.wall = Date.now() - t0;
    const idleMs = Number(args.idle ?? 30_000);
    // Idle network activity: how chatty is a parked screen?
    const before = m.resources.length;
    await page.waitForTimeout(idleMs);
    const idle = await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({ url: e.name.replace(location.origin, ''), size: e.transferSize })));
    m.idle30s = idle.slice(before);
    m.heapAfterIdleMB = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
    // Warm refresh: HTTP cache primed, localStorage save preview present. This
    // is what a real player's F5 looks like.
    if (args.warm) {
        beacon = null;
        await page.evaluate(() => { window.__probe = { longTasks: [], lcp: 0, fcp: 0, cls: 0, shifts: [] }; });
        await page.reload({ waitUntil: 'load' });
        const warmPlayable = await page.waitForFunction(() => {
            const s = document.querySelector('.app-shell[data-screen]')?.getAttribute('data-screen');
            return s && s !== 'start' && s !== 'createCharacter' ? performance.now() : false;
        }, null, { timeout: 90_000 }).then(h => h.jsonValue()).catch(() => null);
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(3500);
        const w = await page.evaluate(COLLECT);
        w.playableAt = warmPlayable ? Math.round(warmPlayable) : null;
        w.beacon = beacon;
        m.warm = { fcp: w.fcp, lcp: w.lcp, dcl: w.dcl, load: w.load, playableAt: w.playableAt, tbt: w.tbt, cls: w.cls, totalKB: Math.round(w.totalBytes / 1024), byType: w.byType, beacon: w.beacon, resources: w.resources, shifts: w.shifts };
    }
    await context.close();
    return m;
}

function summarize(label, runs) {
    const med = (k) => { const v = runs.map(r => r[k]).filter(x => typeof x === 'number').sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    return { label, n: runs.length, ttfb: med('ttfb'), fcp: med('fcp'), lcp: med('lcp'), dcl: med('dcl'), load: med('load'), playableAt: med('playableAt'), tbt: med('tbt'), longTasks: med('longTasks'), longTaskMax: med('longTaskMax'), cls: med('cls'), heapMB: med('heapMB'), totalKB: Math.round((med('totalBytes') ?? 0) / 1024), byType: runs[0].byType, wall: med('wall') };
}

// --prod=https://host : measure only the public landing against a live origin
// (read-only GETs), no local server.
const PROD = typeof args.prod === 'string' ? args.prod.replace(/\/$/, '') : null;
if (PROD) {
    const browser = await chromium.launch();
    const out = { origin: PROD, scenarios: {} };
    const BASE_SAVE = BASE;
    // A fresh browser pays DNS + TLS + certificate revocation checks once. Spend
    // that on /health in a throwaway context so the runs below measure the site,
    // not the machine's cold network stack; the cold figure is kept for reference.
    // --noWarmup skips it, to look at that first navigation itself.
    if (!args.noWarmup) {
        const ctx = await browser.newContext();
        const p = await ctx.newPage();
        const t0 = Date.now();
        await p.goto(PROD + '/health', { waitUntil: 'load' }).catch(() => {});
        out.coldHealthMs = Date.now() - t0;
        out.coldHealthTtfb = await p.evaluate(() => Math.round((performance.getEntriesByType('navigation')[0] || {}).responseStart || 0)).catch(() => null);
        await ctx.close();
        console.log(JSON.stringify({ coldHealthMs: out.coldHealthMs, coldHealthTtfb: out.coldHealthTtfb }));
    }
    for (const [name, opts] of [['prod-landing-desktop', {}], ['prod-landing-mobile-throttled', { mobile: true, throttle: true }]]) {
        const runs = [];
        for (let i = 0; i < RUNS; i++) {
            const { context, page } = await newPage(browser, opts);
            const t0 = Date.now();
            await page.goto(PROD + '/', { waitUntil: 'load' });
            await page.waitForSelector('.app-shell[data-screen]', { timeout: 60_000 }).catch(() => {});
            await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
            await page.waitForTimeout(1500);
            const m = await page.evaluate(COLLECT);
            m.wall = Date.now() - t0;
            m.protocol = await page.evaluate(() => (performance.getEntriesByType('navigation')[0] || {}).nextHopProtocol);
            runs.push(m);
            await context.close();
        }
        out.scenarios[name] = { summary: summarize(name, runs), runs };
        console.log(JSON.stringify({ ...out.scenarios[name].summary, protocol: runs[0].protocol }));
        for (const run of runs) console.log('  nav:', JSON.stringify(run.navBreakdown));
    }
    void BASE_SAVE;
    await browser.close();
    const outPath = args.out ? path.resolve(args.out) : path.join(repoRoot, '.tmp', 'perf-probe', `prod-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log('WROTE', outPath);
    process.exit(0);
}

const { child, log } = startServer();
try {
    await waitHealthy();
    const browser = await chromium.launch();
    const out = { commit: (await (await fetch(`${BASE}/health`)).json()), scenarios: {} };
    const scenarios = args.skipLanding ? [] : [
        ['landing-desktop', () => landing(browser, {})],
        ['landing-mobile-throttled', () => landing(browser, { mobile: true, throttle: true })],
    ];
    for (const [name, fn] of scenarios) {
        const runs = [];
        for (let i = 0; i < RUNS; i++) runs.push(await fn());
        out.scenarios[name] = { summary: summarize(name, runs), runs };
        console.log(JSON.stringify(out.scenarios[name].summary));
    }
    const account = await seedAccount(`perfprobe${Date.now().toString(36).slice(-5)}`);
    for (const [name, opts] of [['restore-desktop', {}], ['restore-mobile-throttled', { mobile: true, throttle: true }]]) {
        const runs = [];
        for (let i = 0; i < (name.includes('throttled') ? Math.min(RUNS, 2) : RUNS); i++) runs.push(await restore(browser, account, opts));
        out.scenarios[name] = { summary: summarize(name, runs), runs };
        console.log(JSON.stringify(out.scenarios[name].summary));
        for (const r of runs) if (r.warm) console.log('  warm:', JSON.stringify({ fcp: r.warm.fcp, lcp: r.warm.lcp, load: r.warm.load, playableAt: r.warm.playableAt, tbt: r.warm.tbt, cls: r.warm.cls, totalKB: r.warm.totalKB, beacon: r.warm.beacon && { tFirstScreen: r.warm.beacon.tFirstScreen, tRestore: r.warm.beacon.tRestore, tPlayable: r.warm.beacon.tPlayable } }));
        for (const r of runs) console.log('  cls-sources:', JSON.stringify(r.shifts?.slice(0, 4)));
    }
    await browser.close();
    const outPath = args.out ? path.resolve(args.out) : path.join(repoRoot, '.tmp', 'perf-probe', `result-${Date.now()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
    console.log('WROTE', outPath);
} catch (e) {
    console.error('PROBE FAILED', e);
    console.error(log().slice(-4000));
    process.exitCode = 1;
} finally {
    child.kill();
}

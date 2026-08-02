/*
 * Fresh-account release certification (P0-6).
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * The standing answer to "would a brand-new player's rewards actually survive
 * a refresh?" It boots the REAL Express server (server.ts — the same handler
 * graph Railway runs), registers a REAL account over HTTP, and walks the
 * reward-critical journey end to end: create → clamp → earn → refresh →
 * relog → retry → stale-autosave. Every assertion is a failure class the
 * Phase 0 audits catalogued.
 *
 * It needs no database and no secrets: the storage layer ships an isolated
 * in-memory backend (SHINOBIX_QA_MEMORY_KV=1 with NODE_ENV=test), so this runs
 * identically on a laptop and in CI.
 *
 *   npm run certify:release            # boot a server and certify
 *   npm run certify:release -- --url=https://staging.example.com   # certify a running server
 *
 * ── What it does NOT cover (be honest about the gap) ────────────────────────
 * The in-memory backend is not Postgres, so this does not exercise pg-specific
 * behavior: the atomic NX lock function, the 10s read cache, or real
 * cross-replica contention. It certifies the API contract and the settlement
 * boundaries, not the storage engine. Point it at a staging server with --url
 * to cover those.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const EXTERNAL_URL = argv.find((a) => a.startsWith('--url='))?.slice('--url='.length) ?? '';
const KEEP_ALIVE = argv.includes('--keep-alive');
const PORT = Number(argv.find((a) => a.startsWith('--port='))?.slice('--port='.length) ?? 41_987);
const BASE = EXTERNAL_URL || `http://127.0.0.1:${PORT}`;

// ── Tiny assertion harness (readable output beats a framework here) ─────────
const results = [];
let currentStep = '';

function step(name) {
    currentStep = name;
}

function check(condition, detail) {
    results.push({ step: currentStep, ok: Boolean(condition), detail });
    const mark = condition ? '  ok  ' : ' FAIL ';
    console.log(`[${mark}] ${currentStep} — ${detail}`);
    return Boolean(condition);
}

function fatal(message) {
    console.error(`\n[certify] ABORTED: ${message}`);
    process.exitCode = 2;
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body, token, name, password, asName } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['x-player-token'] = token;
    // A session token is bound to its player, so reading SOMEONE ELSE'S save
    // requires naming yourself — the token is then checked against that name
    // rather than the route's. This is what the client's authFetch does.
    if (asName) headers['x-player-name'] = asName;
    if (name && password) { headers['x-player-name'] = name; headers['x-player-password'] = password; }
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body: json ?? {} };
}

// The save endpoint enforces a `save-burst` limit of one write per 3s per
// player (api/save/[name].ts). Real clients debounce their autosaves; a
// certification that ignored it would just measure the rate limiter.
const SAVE_BURST_MS = 3_200;
const settleSaveBurst = () => new Promise((r) => setTimeout(r, SAVE_BURST_MS));

async function waitForHealth(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`${BASE}/health`);
            if (res.ok) return true;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 400));
    }
    return false;
}

// ── Server lifecycle ────────────────────────────────────────────────────────
function bootServer() {
    const entry = existsSync(join(process.cwd(), 'dist', 'server.js')) ? ['dist/server.js'] : ['--import', 'tsx', 'server.ts'];
    console.log(`[certify] booting the real server (${entry.join(' ')}) on port ${PORT} with the isolated in-memory backend`);
    const child = spawn(process.execPath, entry, {
        env: {
            ...process.env,
            NODE_ENV: 'test',
            SHINOBIX_QA_MEMORY_KV: '1',
            PORT: String(PORT),
            SESSION_SECRET: randomBytes(32).toString('hex'),
            ADMIN_PASSWORD: randomBytes(16).toString('hex'),
            // Background work has nothing to do in a scratch world and only
            // adds noise to the certification log.
            DISABLE_SCHEDULED_JOBS: '1',
            DISABLE_REALTIME: '1',
            DISABLE_SNAPSHOT_CRON: '1',
            SENTRY_DSN: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = [];
    child.stdout.on('data', (d) => log.push(String(d)));
    child.stderr.on('data', (d) => log.push(String(d)));
    return { child, log };
}

// ── The journey ─────────────────────────────────────────────────────────────
const STARTER_STATS = {
    strength: 10, speed: 10, intelligence: 10, willpower: 10,
    bukijutsuOffense: 10, bukijutsuDefense: 10,
    taijutsuOffense: 10, taijutsuDefense: 10,
    genjutsuOffense: 10, genjutsuDefense: 10,
    ninjutsuOffense: 10, ninjutsuDefense: 10,
};

function freshCharacter(name) {
    return {
        name, village: 'Ember', specialty: 'Ninjutsu', bloodline: 'None',
        level: 1, ryo: 100, stats: { ...STARTER_STATS }, unspentStats: 20,
        hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        inventory: ['rustfang-kunai', 'shinobi-vest'], itemStacks: [], equipment: {},
        pets: [], jutsuMastery: [], equippedJutsuIds: [],
    };
}

async function certify() {
    const suffix = randomBytes(4).toString('hex');
    const player = `certbot${suffix}`;
    const password = `Cert-${randomBytes(8).toString('hex')}A1!`;

    step('server');
    if (!check(await waitForHealth(), `${BASE}/health responds`)) return;

    // 1 ── A brand-new player can register and receives a session token.
    step('register');
    const reg = await api('/api/player-auth', { method: 'POST', body: { action: 'register', name: player, password } });
    if (!check(reg.status === 200 && reg.body.ok === true, `register → ${reg.status}`)) return;
    let token = reg.body.token;
    check(typeof token === 'string' && token.length > 0, 'a session token is issued (token-first auth)');

    // 2 ── First save is clamped to the canonical baseline, not whatever the
    //      client claims. (Historical class: a fresh registration submitting a
    //      level-100 / millions-of-ryo character.)
    step('first save');
    const inflated = { ...freshCharacter(player), level: 100, ryo: 9_999_999, mythicSeals: 500, unspentStats: 9_999 };
    // A real client always echoes a base version — 0 before it has one. The
    // server rejects a version-less player save with 426 (client too old), so
    // omitting it here would certify a request no real client sends.
    const created = await api(`/api/save/${player}`, { method: 'POST', token, body: { character: inflated, _baseSaveVersion: 0 } });
    if (!check(created.status === 200, `first save accepted → ${created.status}`)) return;

    const afterCreate = await api(`/api/save/${player}`, { token });
    const char0 = afterCreate.body.character ?? {};
    check(Number(char0.ryo) === 100, `first-save ryo clamped to the baseline (got ${char0.ryo})`);
    check(Number(char0.level) === 1, `first-save level clamped to 1 (got ${char0.level})`);
    check(Number(char0.mythicSeals ?? 0) === 0, `first-save premium currency clamped to 0 (got ${char0.mythicSeals ?? 0})`);
    const baseVersion = Number(afterCreate.body._saveVersion ?? 0);
    check(baseVersion > 0, `the save carries an optimistic-concurrency version (v${baseVersion})`);

    // 3 ── An ordinary autosave cannot mint currency or forge progression.
    step('tampered autosave');
    const tampered = {
        character: { ...char0, ryo: 5_000_000, fateShards: 900, unlockedAchievements: ['forged'], equipment: { body: 'mythic-battle-plate' } },
        _baseSaveVersion: baseVersion,
    };
    await settleSaveBurst();
    const tamperRes = await api(`/api/save/${player}`, { method: 'POST', token, body: tampered });
    // The write must be ACCEPTED for this step to certify anything: if the
    // server rejected it outright, the clamp assertions below would pass for
    // the wrong reason.
    if (!check(tamperRes.status === 200, `autosave accepted → ${tamperRes.status} (the sanitizer clamps rather than rejects)`)) {
        check(false, 'clamp assertions skipped — the write never reached the sanitizer');
        return;
    }
    const afterTamper = (await api(`/api/save/${player}`, { token })).body.character ?? {};
    check(Number(afterTamper.ryo) <= 1_100, `minted ryo rejected (got ${afterTamper.ryo})`);
    check(Number(afterTamper.fateShards ?? 0) === 0, `minted premium currency rejected (got ${afterTamper.fateShards ?? 0})`);
    check((afterTamper.unlockedAchievements ?? []).length === 0, 'forged achievements rejected (server-owned)');
    check(!(afterTamper.equipment ?? {}).body, 'equipping an unowned item rejected');

    // 4 ── A server-authoritative reward lands and is reported.
    step('earn a reward');
    const claim = await api('/api/player/daily-login', { method: 'POST', token, body: { playerName: player } });
    if (!check(claim.status === 200 && claim.body.ok === true, `daily-login → ${claim.status}`)) return;
    const grantedRyo = Number(claim.body.granted?.ryo ?? 0);
    check(grantedRyo > 0, `the reward granted ryo (+${grantedRyo})`);
    const balanceAfterClaim = Number(claim.body.balances?.ryo ?? 0);
    check(balanceAfterClaim > 0, `the server reports the resulting balance (${balanceAfterClaim})`);

    // 5 ── THE historical failure class: the reward is still there after a refresh.
    step('reward survives refresh');
    const refreshed = await api(`/api/save/${player}`, { token });
    const refreshedRyo = Number(refreshed.body.character?.ryo ?? 0);
    check(refreshedRyo === balanceAfterClaim, `refetched balance matches the credited balance (${refreshedRyo} vs ${balanceAfterClaim})`);

    // 6 ── ...and after a relog on a fresh session.
    step('reward survives relog');
    const relog = await api('/api/player-auth', { method: 'POST', body: { action: 'verify', name: player, password } });
    check(relog.status === 200 && relog.body.ok === true, `re-authentication → ${relog.status}`);
    token = relog.body.token ?? token;
    const afterRelog = await api(`/api/save/${player}`, { token });
    check(Number(afterRelog.body.character?.ryo ?? 0) === balanceAfterClaim, 'the balance survives a new session');

    // 7 ── Retrying the claim does not pay twice (idempotency contract, P0-2).
    step('reward is idempotent');
    const replay = await api('/api/player/daily-login', { method: 'POST', token, body: { playerName: player } });
    check(replay.status === 200 && replay.body.alreadyClaimed === true, 'a retry reports alreadyClaimed');
    check(Number(replay.body.granted?.ryo ?? 0) === 0, `a retry grants nothing (got +${replay.body.granted?.ryo ?? 0})`);
    const afterReplay = await api(`/api/save/${player}`, { token });
    check(Number(afterReplay.body.character?.ryo ?? 0) === balanceAfterClaim, 'the balance is unchanged by the retry');

    // 8 ── A stale autosave is rejected AND cannot roll the reward back.
    //      (This is the exact shape of "my reward disappeared after a refresh".)
    step('stale autosave cannot erase the reward');
    await settleSaveBurst();
    const stale = await api(`/api/save/${player}`, {
        method: 'POST', token,
        body: { character: { ...char0, ryo: 100 }, _baseSaveVersion: baseVersion },
    });
    check(stale.status === 409, `the stale write is rejected → ${stale.status} (expected 409)`);
    const afterStale = await api(`/api/save/${player}`, { token });
    check(Number(afterStale.body.character?.ryo ?? 0) === balanceAfterClaim,
        `the reward survives the stale write (${afterStale.body.character?.ryo} vs ${balanceAfterClaim})`);

    // 9 ── A foreign reader cannot see private state (projection boundary, P0-1).
    step('public projection');
    const other = `certobs${suffix}`;
    const otherPw = `Cert-${randomBytes(8).toString('hex')}B2!`;
    const otherReg = await api('/api/player-auth', { method: 'POST', body: { action: 'register', name: other, password: otherPw } });
    if (otherReg.status === 200) {
        // A reader authenticates against their OWN account, so the observer
        // needs a save of their own first — exactly like a real logged-in player.
        await api(`/api/save/${other}`, {
            method: 'POST', token: otherReg.body.token,
            body: { character: freshCharacter(other), _baseSaveVersion: 0 },
        });
        const foreign = await api(`/api/save/${player}`, { token: otherReg.body.token, asName: other });
        const foreignChar = foreign.body.character ?? {};
        check(foreign.status === 200, `a foreign read is allowed → ${foreign.status}`);
        check(foreignChar.ryo === undefined, 'a foreign reader cannot see the wallet');
        check(foreignChar.stats === undefined, 'a foreign reader cannot see stats (anti-scouting)');
        check(foreign.body._saveVersion === undefined, 'a foreign reader cannot see internal save metadata');
    } else {
        check(false, `could not register the observer account → ${otherReg.status}`);
    }
}

// ── Run ─────────────────────────────────────────────────────────────────────
async function main() {
    let server = null;
    if (!EXTERNAL_URL) server = bootServer();
    try {
        await certify();
    } catch (error) {
        fatal(`journey threw: ${error?.stack ?? error}`);
    } finally {
        if (server && !KEEP_ALIVE) server.child.kill();
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n[certify] ${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) {
        console.log('[certify] FAILED checks:');
        for (const f of failed) console.log(`  • ${f.step} — ${f.detail}`);
        if (server) {
            console.log('\n[certify] server output (last 40 lines):');
            console.log(server.log.join('').split('\n').slice(-40).join('\n'));
        }
    }
    if (results.length === 0) {
        fatal('no checks ran');
        return;
    }
    process.exitCode = failed.length === 0 && !process.exitCode ? 0 : (process.exitCode || 1);
}

await main();

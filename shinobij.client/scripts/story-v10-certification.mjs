import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const port = Number(process.env.SHINOBIX_QA_PORT || 43119);
const baseUrl = `http://127.0.0.1:${port}`;
const adminPassword = 'v10-local-admin-only';
const levels = [4, 15, 25, 35, 50, 65, 75, 85, 100];
const rewards = [
    { xp: 120, ryo: 75 },
    { xp: 500, ryo: 250 },
    { xp: 900, ryo: 500 },
    { xp: 1400, ryo: 800 },
    { xp: 2200, ryo: 1300 },
    { xp: 3400, ryo: 2000 },
    { xp: 4600, ryo: 2800 },
    { xp: 6200, ryo: 4000 },
    { xp: 10000, ryo: 7500 },
];
const villages = [
    { name: 'Stormveil Village', account: 'v10stormcert', title: 'Stormbreaker' },
    { name: 'Ashen Leaf Village', account: 'v10ashcert', title: 'Root Liberator' },
    { name: 'Frostfang Village', account: 'v10frostcert', title: 'Oathbreaker' },
    { name: 'Moonshadow Village', account: 'v10mooncert', title: 'Moon Unmasked' },
];

async function buildFreshClient() {
    const clientRoot = path.join(repoRoot, 'shinobij.client');
    const command = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
    const args = process.platform === 'win32'
        ? ['/d', '/s', '/c', 'npm run build']
        : ['run', 'build'];
    const child = spawn(command, args, {
        cwd: clientRoot,
        stdio: 'inherit',
    });
    await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`Client build failed before story certification (${signal ?? `exit ${code}`}).`));
        });
    });
}

function isolatedServerEnv() {
    const env = {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        SHINOBIX_QA_MEMORY_KV: '1',
        STATIC_DIR: path.join(repoRoot, 'shinobij.client', 'dist'),
        ADMIN_PASSWORD: adminPassword,
        SESSION_SECRET: 'story-v10-local-session-secret-0123456789abcdef0123456789abcdef',
        DISABLE_REALTIME: '1',
        DISABLE_SNAPSHOT_CRON: '1',
        DISABLE_VILLAGE_WAR: '1',
        DISABLE_CLAN_BOSS: '1',
        DISABLE_SCHEDULED_JOBS: '1',
        SENTRY_DSN: '',
    };
    for (const key of [
        'DATABASE_URL', 'SUPABASE_POSTGRES_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
        'DISK_KV_DIR', 'KV_PROXY_URL', 'KV_PROXY_TOKEN', 'REQUIRE_DISK_OVERLAY', 'VERCEL',
        'MAINTENANCE_MODE', 'DISABLE_NEW_REGISTRATIONS', 'FREEZE_ECONOMY_REWARDS',
    ]) delete env[key];
    return env;
}

async function waitForServer(child) {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`QA server exited early with code ${child.exitCode}.`);
        try {
            const response = await fetch(`${baseUrl}/health`);
            if (response.ok) return;
        } catch { /* still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error('Timed out waiting for the isolated QA server.');
}

async function request(page, pathname, { method = 'GET', headers = {}, body } = {}) {
    return page.evaluate(async ({ pathname, method, headers, body }) => {
        const response = await fetch(pathname, {
            method,
            headers,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await response.text();
        let parsed = null;
        if (text) {
            try { parsed = JSON.parse(text); } catch { parsed = text; }
        }
        return { status: response.status, body: parsed };
    }, { pathname, method, headers, body });
}

function seedCharacter(account, village) {
    const stats = {
        strength: 10, speed: 10, intelligence: 10, willpower: 10,
        bukijutsuOffense: 10, bukijutsuDefense: 10,
        taijutsuOffense: 10, taijutsuDefense: 10,
        genjutsuOffense: 10, genjutsuDefense: 10,
        ninjutsuOffense: 10, ninjutsuDefense: 10,
    };
    return {
        name: account,
        village,
        storyVillage: village,
        level: 100,
        xp: 0,
        rank: 'Special Jonin',
        rankTitle: 'Special Jonin',
        specialty: 'Ninjutsu',
        stats,
        unspentStats: 0,
        storyProgress: 0,
        storyTraits: [],
        redeemedStoryBattles: [],
        ryo: 1000,
        auraDust: 0,
        hp: 1000,
        maxHp: 1000,
        chakra: 1000,
        maxChakra: 1000,
        stamina: 1000,
        maxStamina: 1000,
        inventory: [],
        pets: [],
        activePetId: '',
        examsPassed: ['genin', 'chunin'],
        onboardingStep: 'done',
    };
}

function opponentId(village, level) {
    return `story-ai-${village.toLowerCase().replace(/\W+/g, '-')}-${level}`;
}

async function openOriginPage(browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${baseUrl}/robots.txt`, { waitUntil: 'domcontentloaded' });
    return { context, page };
}

async function certifyVillage(browser, village, index) {
    const { context, page } = await openOriginPage(browser);
    const password = `StoryCert${index + 1}9`;
    const registered = await request(page, '/api/player-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: { action: 'register', name: village.account, password },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    const token = registered.body?.token;
    assert.equal(typeof token, 'string');

    const seeded = await request(page, `/api/save/${village.account}?signal=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPassword },
        body: { character: seedCharacter(village.account, village.name), currentSector: 40 },
    });
    assert.equal(seeded.status, 200, JSON.stringify(seeded.body));

    const playerHeaders = {
        'Content-Type': 'application/json',
        'x-player-name': village.account,
        'x-player-token': token,
    };
    let expectedRyo = 1000;
    let expectedAuraDust = 0;
    let refreshRegeneratedToken = false;
    let lossRetryRejectedOldToken = false;

    for (let progress = 0; progress < levels.length; progress += 1) {
        const level = levels[progress];
        const fightBody = {
            playerName: village.account,
            opponentId: opponentId(village.name, level),
            opponentLevel: level,
            battleKind: 'practice',
        };

        let discardedToken = null;
        if (index === 0 && progress === 2) {
            const lostFight = await request(page, '/api/missions/ai-fight-start', {
                method: 'POST', headers: playerHeaders, body: fightBody,
            });
            assert.equal(lostFight.status, 200, JSON.stringify(lostFight.body));
            discardedToken = lostFight.body.token;
            const afterLoss = await request(page, `/api/save/${village.account}`, { headers: playerHeaders });
            assert.equal(afterLoss.status, 200);
            assert.equal(afterLoss.body.character.storyProgress, progress, 'a loss must not advance or pay');
        }

        let started = await request(page, '/api/missions/ai-fight-start', {
            method: 'POST', headers: playerHeaders, body: fightBody,
        });
        assert.equal(started.status, 200, JSON.stringify(started.body));

        if (index === 1 && progress === 4) {
            const preRefreshToken = started.body.token;
            await page.reload({ waitUntil: 'domcontentloaded' });
            started = await request(page, '/api/missions/ai-fight-start', {
                method: 'POST', headers: playerHeaders, body: fightBody,
            });
            assert.equal(started.status, 200, JSON.stringify(started.body));
            assert.notEqual(started.body.token, preRefreshToken, 'refresh must get a fresh battle lifecycle token');
            discardedToken = preRefreshToken;
            refreshRegeneratedToken = true;
        }

        const settled = await request(page, '/api/story/settle', {
            method: 'POST',
            headers: playerHeaders,
            body: { playerName: village.account, aiFightToken: started.body.token, survivingHp: 300 },
        });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.progress, progress + 1);
        assert.equal(settled.body.xp, rewards[progress].xp);
        assert.equal(settled.body.ryo, rewards[progress].ryo);
        expectedRyo += rewards[progress].ryo;
        expectedAuraDust += 12;

        const snapshot = await request(page, `/api/save/${village.account}`, { headers: playerHeaders });
        assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
        assert.equal(snapshot.body.character.storyProgress, progress + 1);
        assert.equal(snapshot.body.character.ryo, expectedRyo);
        assert.equal(snapshot.body.character.auraDust, expectedAuraDust);
        assert.equal(snapshot.body.character.redeemedStoryBattles.length, progress + 1);

        if (discardedToken) {
            const stale = await request(page, '/api/story/settle', {
                method: 'POST',
                headers: playerHeaders,
                body: { playerName: village.account, aiFightToken: discardedToken, survivingHp: 300 },
            });
            assert.equal(stale.status, 409, 'a discarded loss/refresh token must not pay after retry settlement');
            if (index === 0 && progress === 2) lossRetryRejectedOldToken = true;
        }

        if (progress === levels.length - 1) {
            const replay = await request(page, '/api/story/settle', {
                method: 'POST',
                headers: playerHeaders,
                body: { playerName: village.account, aiFightToken: started.body.token, survivingHp: 300 },
            });
            assert.equal(replay.status, 200, JSON.stringify(replay.body));
            assert.equal(replay.body.replayed, true);
            assert.equal(replay.body.character.ryo, expectedRyo);
            assert.equal(replay.body.character.auraDust, expectedAuraDust);
        }
    }

    const finalSave = await request(page, `/api/save/${village.account}`, { headers: playerHeaders });
    assert.equal(finalSave.status, 200);
    const finalCharacter = finalSave.body.character;
    assert.equal(finalCharacter.storyProgress, 9);
    assert.equal(finalCharacter.storyTitle, village.title);
    assert.equal(finalCharacter.rankTitle, village.title);
    assert.equal(finalCharacter.inventory.filter((id) => id === 'hollow-gate-key').length, 1);
    assert.equal(finalCharacter.redeemedStoryBattles.length, 9);

    await context.close();
    return {
        account: village.account,
        token,
        finalSave: finalSave.body,
        playerHeaders,
        refreshRegeneratedToken,
        lossRetryRejectedOldToken,
    };
}

async function certifyTwoSessionConflict(browser, result) {
    const a = await openOriginPage(browser);
    const b = await openOriginPage(browser);
    try {
        const acknowledged = await request(a.page, `/api/save/${result.account}?ack=1`, {
            method: 'POST',
            headers: result.playerHeaders,
            body: {},
        });
        assert.equal(acknowledged.status, 200, JSON.stringify(acknowledged.body));
        const snapA = await request(a.page, `/api/save/${result.account}`, { headers: result.playerHeaders });
        const snapB = await request(b.page, `/api/save/${result.account}`, { headers: result.playerHeaders });
        assert.equal(snapA.status, 200);
        assert.equal(snapB.status, 200);
        assert.equal(snapA.body._saveVersion, snapB.body._saveVersion);
        const baseVersion = snapA.body._saveVersion;

        const writeA = await request(a.page, `/api/save/${result.account}`, {
            method: 'POST',
            headers: result.playerHeaders,
            body: { ...snapA.body, currentSector: 41, _baseSaveVersion: baseVersion },
        });
        assert.equal(writeA.status, 200, JSON.stringify(writeA.body));
        assert.equal(writeA.body._saveVersion, baseVersion + 1);

        await new Promise((resolve) => setTimeout(resolve, 3_100));
        const staleWriteB = await request(b.page, `/api/save/${result.account}`, {
            method: 'POST',
            headers: result.playerHeaders,
            body: { ...snapB.body, currentSector: 42, _baseSaveVersion: baseVersion },
        });
        assert.equal(staleWriteB.status, 409, JSON.stringify(staleWriteB.body));
        assert.equal(staleWriteB.body.currentVersion, baseVersion + 1);

        const final = await request(a.page, `/api/save/${result.account}`, { headers: result.playerHeaders });
        assert.equal(final.status, 200);
        assert.equal(final.body.currentSector, 41, 'the stale second session must not overwrite the first');
        return {
            baseVersion,
            acceptedVersion: writeA.body._saveVersion,
            staleWriteRejectedAgainstVersion: staleWriteB.body.currentVersion,
            finalReadVersion: final.body._saveVersion,
        };
    } finally {
        await Promise.all([a.context.close(), b.context.close()]);
    }
}

async function certifyWeakNetwork(browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const failures = [];
    page.on('requestfailed', (req) => failures.push(`${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}`));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 180,
        downloadThroughput: 500 * 1024 / 8,
        uploadThroughput: 250 * 1024 / 8,
        connectionType: 'cellular3g',
    });
    const startedAt = Date.now();
    const response = await page.goto(`${baseUrl}/?v10-weak-network=1`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(response?.status(), 200);
    assert.equal(failures.length, 0, failures.join('\n'));
    assert.ok(await page.locator('body').innerText(), 'the throttled app shell must render content');
    await context.close();
    return { profile: '500 Kbps down / 250 Kbps up / 180 ms RTT', elapsedMs, failedRequests: 0 };
}

// The browser portion must certify the source being reviewed, never whichever
// tracked bundle happened to be left in dist by an earlier build.
await buildFreshClient();

const serverLogs = [];
const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: repoRoot,
    env: isolatedServerEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => serverLogs.push(String(chunk)));
server.stderr.on('data', (chunk) => serverLogs.push(String(chunk)));

let browser;
try {
    await waitForServer(server);
    browser = await chromium.launch();
    const villageResults = [];
    for (let i = 0; i < villages.length; i += 1) {
        villageResults.push(await certifyVillage(browser, villages[i], i));
    }
    assert.equal(villageResults[0].lossRetryRejectedOldToken, true);
    assert.equal(villageResults[1].refreshRegeneratedToken, true);
    const conflict = await certifyTwoSessionConflict(browser, villageResults[0]);
    const weakNetwork = await certifyWeakNetwork(browser);

    const summary = {
        result: 'PASS',
        backend: 'isolated in-memory KV + production Express routes',
        transport: 'Chromium fetch over HTTP',
        villages: 4,
        authenticatedAccounts: 4,
        settledBosses: 36,
        finales: villages.map((v) => v.title),
        rewardLedgers: villageResults.map((r) => r.finalSave.character.redeemedStoryBattles.length),
        hollowGateKeys: villageResults.map((r) => r.finalSave.character.inventory.filter((id) => id === 'hollow-gate-key').length),
        lossRetry: 'discarded loss token rejected after retry settlement',
        refreshMidBattle: 'page reload regenerated the battle token; pre-refresh token could not pay afterward',
        twoSessionConflict: conflict,
        weakNetwork,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.stderr.write(serverLogs.slice(-20).join(''));
    process.exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => undefined);
    if (server.exitCode === null) server.kill('SIGINT');
}

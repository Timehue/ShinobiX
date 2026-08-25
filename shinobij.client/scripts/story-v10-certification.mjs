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
    { ryo: 75 },
    { ryo: 250 },
    { ryo: 500 },
    { ryo: 800 },
    { ryo: 1300 },
    { ryo: 2000 },
    { ryo: 2800 },
    { ryo: 4000 },
    { ryo: 7500 },
];
const villages = [
    { name: 'Stormveil Village', account: 'v10stormcert', title: 'Stormbreaker' },
    { name: 'Ashen Leaf Village', account: 'v10ashcert', title: 'Root Liberator' },
    { name: 'Frostfang Village', account: 'v10frostcert', title: 'Oathbreaker' },
    { name: 'Moonshadow Village', account: 'v10mooncert', title: 'Moon Unmasked' },
];

async function buildFreshClient() {
    const clientRoot = path.join(repoRoot, 'shinobij.client');
    // npm on Windows is npm.cmd, which Node refuses to spawn without a shell, so go
    // through cmd.exe explicitly — resolved from PATH rather than the ComSpec env var.
    const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
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
    const equippedJutsuIds = [
        'starter-nin-fire-2',
        'starter-nin-water-2',
        'starter-nin-wind-2',
        'starter-nin-earth-2',
        'starter-nin-lightning-2',
    ];
    const stats = {
        strength: 2500, speed: 2500, intelligence: 2500, willpower: 2500,
        bukijutsuOffense: 2500, bukijutsuDefense: 2500,
        taijutsuOffense: 2500, taijutsuDefense: 2500,
        genjutsuOffense: 2500, genjutsuDefense: 2500,
        ninjutsuOffense: 2500, ninjutsuDefense: 2500,
    };
    const equipment = {
        head: 'bulwark-crown',
        body: 'bulwark-chest',
        legs: 'bulwark-legs',
        feet: 'bulwark-feet',
        waist: 'bulwark-waist',
        relic: 'relic-stormglass-pendulum',
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
        equippedBloodlineId: 'starter-bloodline-inferno-cataclysm',
        stats,
        unspentStats: 0,
        storyProgress: 0,
        storyTraits: [],
        equippedJutsuIds,
        jutsuMastery: equippedJutsuIds.map((jutsuId) => ({ jutsuId, level: 50, xp: 0 })),
        redeemedStoryBattles: [],
        ryo: 1000,
        auraDust: 0,
        hp: 10000,
        maxHp: 10000,
        chakra: 10000,
        maxChakra: 10000,
        stamina: 10000,
        maxStamina: 10000,
        inventory: Object.values(equipment),
        equipment,
        pets: [],
        activePetId: '',
        examsPassed: ['genin', 'chunin'],
        onboardingStep: 'done',
    };
}

const SOLO_GRID_W = 12;
const SOLO_GRID_H = 10;

function soloHexNeighbors(pos) {
    const x = pos % SOLO_GRID_W;
    const y = Math.floor(pos / SOLO_GRID_W);
    const deltas = x % 2 === 0
        ? [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [0, 1]]
        : [[1, 1], [1, 0], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    return deltas
        .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
        .filter((tile) => tile.x >= 0 && tile.x < SOLO_GRID_W && tile.y >= 0 && tile.y < SOLO_GRID_H)
        .map((tile) => tile.y * SOLO_GRID_W + tile.x);
}

function soloHexDistance(a, b) {
    const axial = (pos) => {
        const x = pos % SOLO_GRID_W;
        const y = Math.floor(pos / SOLO_GRID_W);
        return { q: x, r: y - ((x - (x & 1)) / 2) };
    };
    const first = axial(a);
    const second = axial(b);
    return (
        Math.abs(first.q - second.q)
        + Math.abs(first.q + first.r - second.q - second.r)
        + Math.abs(first.r - second.r)
    ) / 2;
}

async function fightStoryRun(page, playerHeaders, account, runId, initialSession, label) {
    let session = initialSession;
    for (let turn = 0; turn < 160 && session?.status !== 'done'; turn += 1) {
        const mine = session.player;
        const foe = session.enemy;
        assert.ok(mine && foe, `${label}: authoritative session lost a combatant`);
        const adjacent = soloHexDistance(mine.pos, foe.pos) <= 1;
        const distance = soloHexDistance(mine.pos, foe.pos);
        const cooldowns = session.cooldowns?.player ?? {};
        const shouldHeal = mine.hp < mine.maxHp * 0.45 && Number(cooldowns.basicHeal ?? 0) <= 0;
        const readyJutsu = (mine.character?.jutsu ?? []).find((jutsu) => (
            Number(jutsu?.effectPower) > 0
            && Number(jutsu?.range) >= distance
            && Number(cooldowns[jutsu.id] ?? 0) <= 0
        ));
        const blocked = new Set(session.environment?.blockedTiles ?? []);
        const nextTile = soloHexNeighbors(mine.pos)
            .filter((tile) => tile !== foe.pos && !blocked.has(tile))
            .sort((a, b) => soloHexDistance(a, foe.pos) - soloHexDistance(b, foe.pos) || a - b)[0];
        const move = shouldHeal
            ? { type: 'basicHeal' }
            : readyJutsu
                ? { type: 'jutsu', jutsuId: readyJutsu.id, tile: foe.pos }
                : adjacent || nextTile === undefined
                    ? { type: 'basicAttack' }
                    : { type: 'move', tile: nextTile };
        const acted = await request(page, '/api/solo-pve/action', {
            method: 'POST',
            headers: playerHeaders,
            body: {
                playerName: account,
                sessionId: runId,
                expectedVersion: session.version,
                moveToken: `${label}-turn-${turn}-${session.version}`,
                ...move,
            },
        });
        let next = acted.body?.session;
        if (acted.status !== 200 || acted.body?.applied === false) {
            const current = next ?? session;
            const passed = await request(page, '/api/solo-pve/action', {
                method: 'POST',
                headers: playerHeaders,
                body: {
                    playerName: account,
                    sessionId: runId,
                    expectedVersion: current.version,
                    moveToken: `${label}-wait-${turn}-${current.version}`,
                    type: 'wait',
                },
            });
            next = passed.body?.session ?? next;
            assert.ok(passed.status === 200 || acted.status === 200, `${label}: combat action failed (${acted.status}/${passed.status})`);
        }
        assert.ok(next, `${label}: combat action returned no session`);
        session = next;
    }
    assert.equal(session?.status, 'done', `${label}: story combat did not finish`);
    assert.equal(session?.winner, 'player', `${label}: certification shinobi did not win`);
    return session;
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
    let refreshRecoveredRun = false;
    let unfinishedRunRejected = false;

    for (let progress = 0; progress < levels.length; progress += 1) {
        const fightBody = { playerName: village.account };

        let unfinishedRunId = null;
        if (index === 0 && progress === 2) {
            const unfinished = await request(page, '/api/story/boss-start', {
                method: 'POST', headers: playerHeaders, body: fightBody,
            });
            assert.equal(unfinished.status, 200, JSON.stringify(unfinished.body));
            unfinishedRunId = unfinished.body.runId;
            const refused = await request(page, '/api/story/settle', {
                method: 'POST',
                headers: playerHeaders,
                body: { playerName: village.account, runId: unfinishedRunId, kind: 'storyBoss' },
            });
            assert.equal(refused.status, 409, 'an unfinished run must not advance or pay');
        }

        let started = await request(page, '/api/story/boss-start', {
            method: 'POST', headers: playerHeaders, body: fightBody,
        });
        assert.equal(started.status, 200, JSON.stringify(started.body));

        if (index === 1 && progress === 4) {
            const preRefreshRunId = started.body.runId;
            await page.reload({ waitUntil: 'domcontentloaded' });
            const recovered = await request(
                page,
                `/api/solo-pve/state?sessionId=${encodeURIComponent(preRefreshRunId)}&playerName=${encodeURIComponent(village.account)}`,
                { headers: playerHeaders },
            );
            assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
            assert.equal(recovered.body.session.sessionId, preRefreshRunId, 'refresh must recover the same sealed story run');
            started = { ...started, body: { ...started.body, session: recovered.body.session } };
            refreshRecoveredRun = true;
        }

        await fightStoryRun(
            page,
            playerHeaders,
            village.account,
            started.body.runId,
            started.body.session,
            `story-${index}-${progress}`,
        );
        const settled = await request(page, '/api/story/settle', {
            method: 'POST',
            headers: playerHeaders,
            body: { playerName: village.account, runId: started.body.runId, kind: 'storyBoss' },
        });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.progress, progress + 1);
        assert.equal(settled.body.xp, 0, 'character XP is retired');
        assert.equal(settled.body.ryo, rewards[progress].ryo);
        expectedRyo += rewards[progress].ryo;
        expectedAuraDust += 12;

        const snapshot = await request(page, `/api/save/${village.account}`, { headers: playerHeaders });
        assert.equal(snapshot.status, 200, JSON.stringify(snapshot.body));
        assert.equal(snapshot.body.character.storyProgress, progress + 1);
        assert.equal(snapshot.body.character.ryo, expectedRyo);
        assert.equal(snapshot.body.character.auraDust, expectedAuraDust);
        assert.equal(snapshot.body.character.redeemedStoryBattles.length, progress + 1);

        if (unfinishedRunId) {
            const stale = await request(page, '/api/story/settle', {
                method: 'POST',
                headers: playerHeaders,
                body: { playerName: village.account, runId: unfinishedRunId, kind: 'storyBoss' },
            });
            assert.equal(stale.status, 409, 'an unfinished run must not pay after another run settles');
            if (index === 0 && progress === 2) unfinishedRunRejected = true;
        }

        if (progress === levels.length - 1) {
            const replay = await request(page, '/api/story/settle', {
                method: 'POST',
                headers: playerHeaders,
                body: { playerName: village.account, runId: started.body.runId, kind: 'storyBoss' },
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
        refreshRecoveredRun,
        unfinishedRunRejected,
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
    assert.equal(villageResults[0].unfinishedRunRejected, true);
    assert.equal(villageResults[1].refreshRecoveredRun, true);
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
        unfinishedRun: 'unfinished authoritative run rejected before and after another run settled',
        refreshMidBattle: 'page reload recovered the same authoritative story run',
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

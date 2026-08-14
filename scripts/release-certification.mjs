/*
 * Fresh-account release certification (P0-6).
 *
 * ── What this is ────────────────────────────────────────────────────────────
 * The standing answer to "would a brand-new player's rewards actually survive
 * a refresh?" It boots the REAL Express server (server.ts — the same handler
 * graph Railway runs), registers a REAL account over HTTP, and walks the
 * reward-critical journey end to end: create → clamp → reject forged currency →
 * sanitize forged progression → earn → refresh → relog → retry → stale autosave,
 * then completes authoritative Solo PvE and two-account PvP lifecycles. Every
 * assertion maps to a failure class catalogued by the Phase 0 audits.
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

// Solo PvE uses the shared 12x10 odd-q hex board. Keep the live journey's
// pathing local to this dependency-free script so certification can run
// against either the source server or a built release artifact.
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

    // 3 ── Currency is server-authoritative. A forged increase must be rejected
    //      explicitly and atomically so the client can repair its local balance
    //      without persisting any other fields from the rejected request.
    step('forged currency is rejected atomically');
    const forgedCurrency = {
        character: { ...char0, ryo: 5_000_000, fateShards: 900, unlockedAchievements: ['forged'], equipment: { body: 'mythic-battle-plate' } },
        _baseSaveVersion: baseVersion,
    };
    await settleSaveBurst();
    const rejectedMint = await api(`/api/save/${player}`, { method: 'POST', token, body: forgedCurrency });
    if (!check(rejectedMint.status === 409, `forged ryo increase rejected → ${rejectedMint.status} (expected 409)`)) {
        check(false, 'server-authority response assertions skipped — the request was not rejected by the expected boundary');
        return;
    }
    check(rejectedMint.body.code === 'RYO_SERVER_AUTHORITY', `stable repair code returned (${rejectedMint.body.code ?? 'missing'})`);
    check(Number(rejectedMint.body.authoritativeRyo) === Number(char0.ryo),
        `authoritative balance returned (${rejectedMint.body.authoritativeRyo} vs ${char0.ryo})`);
    check(Number(rejectedMint.body._saveVersion) === baseVersion,
        `authoritative save version returned (v${rejectedMint.body._saveVersion} vs v${baseVersion})`);

    const afterRejectedMint = await api(`/api/save/${player}`, { token });
    const charAfterRejectedMint = afterRejectedMint.body.character ?? {};
    check(afterRejectedMint.status === 200, `save remains readable after rejection → ${afterRejectedMint.status}`);
    check(Number(afterRejectedMint.body._saveVersion) === baseVersion,
        `rejected write does not advance the save version (v${afterRejectedMint.body._saveVersion})`);
    check(JSON.stringify(charAfterRejectedMint) === JSON.stringify(char0),
        'rejected write leaves the complete character snapshot unchanged');
    check(Number(charAfterRejectedMint.ryo) === Number(char0.ryo),
        `rejected write cannot mint ryo (${charAfterRejectedMint.ryo} vs ${char0.ryo})`);
    check(Number(charAfterRejectedMint.fateShards ?? 0) === Number(char0.fateShards ?? 0),
        'rejected write cannot mutate premium currency');
    check(JSON.stringify(charAfterRejectedMint.unlockedAchievements ?? []) === JSON.stringify(char0.unlockedAchievements ?? []),
        'rejected write cannot mutate achievements');
    check(JSON.stringify(charAfterRejectedMint.equipment ?? {}) === JSON.stringify(char0.equipment ?? {}),
        'rejected write cannot mutate equipment');

    // 4 ── Keep the sanitizer boundary independently certified. With the
    //      authoritative balance echoed unchanged, an otherwise ordinary
    //      autosave is accepted while forged server-owned fields are stripped.
    step('forged progression is sanitized');
    const forgedProgression = {
        character: { ...char0, fateShards: 900, unlockedAchievements: ['forged'], equipment: { body: 'mythic-battle-plate' } },
        _baseSaveVersion: baseVersion,
    };
    await settleSaveBurst();
    const sanitizedWrite = await api(`/api/save/${player}`, { method: 'POST', token, body: forgedProgression });
    if (!check(sanitizedWrite.status === 200, `same-balance autosave accepted for sanitization → ${sanitizedWrite.status}`)) return;

    const afterSanitizedWrite = await api(`/api/save/${player}`, { token });
    const sanitizedChar = afterSanitizedWrite.body.character ?? {};
    check(afterSanitizedWrite.status === 200, `sanitized save can be read back → ${afterSanitizedWrite.status}`);
    check(Number(afterSanitizedWrite.body._saveVersion) === baseVersion + 1,
        `accepted sanitized write advances the save version once (v${afterSanitizedWrite.body._saveVersion})`);
    check(Number(sanitizedChar.ryo) === Number(char0.ryo), `authoritative ryo is preserved (got ${sanitizedChar.ryo})`);
    check(Number(sanitizedChar.fateShards ?? 0) === Number(char0.fateShards ?? 0),
        `minted premium currency sanitized (got ${sanitizedChar.fateShards ?? 0})`);
    check(JSON.stringify(sanitizedChar.unlockedAchievements ?? []) === JSON.stringify(char0.unlockedAchievements ?? []),
        'forged achievements sanitized (server-owned)');
    check(JSON.stringify(sanitizedChar.equipment ?? {}) === JSON.stringify(char0.equipment ?? {}),
        'unowned equipment sanitized');

    // 5 ── A server-authoritative reward lands and is reported.
    step('earn a reward');
    const claim = await api('/api/player/daily-login', { method: 'POST', token, body: { playerName: player } });
    if (!check(claim.status === 200 && claim.body.ok === true, `daily-login → ${claim.status}`)) return;
    const grantedRyo = Number(claim.body.granted?.ryo ?? 0);
    check(grantedRyo > 0, `the reward granted ryo (+${grantedRyo})`);
    const balanceAfterClaim = Number(claim.body.balances?.ryo ?? 0);
    check(balanceAfterClaim > 0, `the server reports the resulting balance (${balanceAfterClaim})`);

    // 6 ── THE historical failure class: the reward is still there after a refresh.
    step('reward survives refresh');
    const refreshed = await api(`/api/save/${player}`, { token });
    const refreshedRyo = Number(refreshed.body.character?.ryo ?? 0);
    check(refreshedRyo === balanceAfterClaim, `refetched balance matches the credited balance (${refreshedRyo} vs ${balanceAfterClaim})`);

    // 7 ── ...and after a relog on a fresh session.
    step('reward survives relog');
    const relog = await api('/api/player-auth', { method: 'POST', body: { action: 'verify', name: player, password } });
    check(relog.status === 200 && relog.body.ok === true, `re-authentication → ${relog.status}`);
    token = relog.body.token ?? token;
    const afterRelog = await api(`/api/save/${player}`, { token });
    check(Number(afterRelog.body.character?.ryo ?? 0) === balanceAfterClaim, 'the balance survives a new session');

    // 8 ── Retrying the claim does not pay twice (idempotency contract, P0-2).
    step('reward is idempotent');
    const replay = await api('/api/player/daily-login', { method: 'POST', token, body: { playerName: player } });
    check(replay.status === 200 && replay.body.alreadyClaimed === true, 'a retry reports alreadyClaimed');
    check(Number(replay.body.granted?.ryo ?? 0) === 0, `a retry grants nothing (got +${replay.body.granted?.ryo ?? 0})`);
    const afterReplay = await api(`/api/save/${player}`, { token });
    check(Number(afterReplay.body.character?.ryo ?? 0) === balanceAfterClaim, 'the balance is unchanged by the retry');

    // 9 ── A stale autosave is rejected AND cannot roll the reward back.
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

    // 10 ── A foreign reader cannot see private state (projection boundary, P0-1).
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

    // 11 ── The Academy spar, fought on the server.
    //
    // Step 5 subsystem 1 of the AI-fight migration moved the onboarding spar's
    // opponent server-side so the fight could be sealed at all. This is the
    // journey the runbook asks for per migrated mode, and it is the closest
    // thing to "a real account played the tutorial": a registered player, the
    // real HTTP API, the real handlers.
    //
    // The two failure modes worth a live check are opposites — a spar that
    // cannot pay out (the player fights for nothing), and a payout without a
    // won fight (the thing the migration exists to prevent).
    step('academy spar');
    await settleSaveBurst();
    const sparSave = await api(`/api/save/${player}`, { token });
    const sparBase = sparSave.body.character ?? {};
    const sparWrite = await api(`/api/save/${player}`, {
        method: 'POST', token,
        body: {
            character: { ...sparBase, onboardingStep: 'academySpar' },
            _baseSaveVersion: sparSave.body._saveVersion ?? 0,
        },
    });
    if (check(sparWrite.status === 200, `onboarding set to the spar step → ${sparWrite.status}`)) {
        // The body deliberately tries to choose the fight. None of it is read:
        // the endpoint takes the opponent from api/story/_academy-spar.ts.
        const started = await api('/api/story/spar-start', {
            method: 'POST', token,
            body: { playerName: player, opponentId: 'apex-ai-ancient-chakra-beast', opponentLevel: 100, hp: 1 },
        });
        if (check(started.status === 200 && !!started.body.runId, `spar sealed → ${started.status}`)) {
            const sealedSession = started.body.session;
            const enemy = sealedSession?.enemy;
            check(sealedSession?.runtime === 'solo-pve', `the sealed session uses Solo PvE (got ${sealedSession?.runtime})`);
            check(!!enemy, 'the sealed session carries the server-owned opponent');
            check(Number(enemy?.character?.level) === 1, `the dummy is level 1 (got ${enemy?.character?.level})`);
            // <= rather than ===: the shared PvE band may soften it further, but
            // it must never be TOUGHER than the authored 50-HP dummy.
            check(Number(enemy?.maxHp ?? 0) > 0 && Number(enemy?.maxHp ?? 0) <= 50, `the dummy keeps its tutorial HP (got ${enemy?.maxHp})`);
            check(!/Ancient/i.test(String(enemy?.name ?? '')), 'the request could not swap in a level-100 opponent');

            // The reward must not be payable from a run that was never won.
            const early = await api('/api/story/settle', {
                method: 'POST', token,
                body: { playerName: player, kind: 'academySparring', runId: started.body.runId },
            });
            check(early.status === 409, `settling an unfinished spar is refused → ${early.status}`);
            const afterEarly = await api(`/api/save/${player}`, { token });
            check(
                Number(afterEarly.body.character?.ryo ?? 0) === Number(sparBase.ryo ?? 0),
                'the refused settle paid nothing',
            );
            check(afterEarly.body.character?.academySparClaimed !== true, 'and did not latch the one-time claim');

            // Now actually FIGHT it. Everything above proves the spar cannot be
            // cheated; this proves it can be WON, which is the half a new player
            // actually experiences. Close on the dummy and swing until the run
            // resolves — a level-1 basic attack against the tutorial dummy.
            const runId = started.body.runId;
            let session = started.body.session;
            for (let turn = 0; turn < 160 && session?.status !== 'done'; turn++) {
                const mine = session.player;
                const foe = session.enemy;
                if (!mine || !foe) break;
                const adjacent = soloHexDistance(mine.pos, foe.pos) <= 1;
                const blocked = new Set(session.environment?.blockedTiles ?? []);
                const nextTile = soloHexNeighbors(mine.pos)
                    .filter((tile) => tile !== foe.pos && !blocked.has(tile))
                    .sort((a, b) => soloHexDistance(a, foe.pos) - soloHexDistance(b, foe.pos) || a - b)[0];
                const move = adjacent ? { type: 'basicAttack' } : { type: 'move', tile: nextTile };
                const acted = await api('/api/solo-pve/action', {
                    method: 'POST', token,
                    body: {
                        playerName: player,
                        sessionId: runId,
                        expectedVersion: session.version,
                        moveToken: `cert-spar-${turn}-${session.version}`,
                        ...move,
                    },
                });
                // A refused move still comes back WITH a session (out of AP, a
                // blocked tile, not our turn), so `applied` is the thing to read —
                // keying off the session alone spins forever without ever ending
                // the turn. `wait` hands over and refills AP.
                let next = acted.body?.session;
                if (acted.status !== 200 || acted.body?.applied === false) {
                    const current = next ?? session;
                    const passed = await api('/api/solo-pve/action', {
                        method: 'POST', token,
                        body: {
                            playerName: player,
                            sessionId: runId,
                            expectedVersion: current.version,
                            moveToken: `cert-spar-wait-${turn}-${current.version}`,
                            type: 'wait',
                        },
                    });
                    next = passed.body?.session ?? next;
                    if (passed.status !== 200 && acted.status !== 200) break;
                }
                if (!next) break;
                session = next;
            }
            if (check(session?.status === 'done', `the spar was fought to a resolution (status ${session?.status})`)) {
                check(session.winner === 'player', `the tutorial dummy falls to a level-1 player (winner ${session.winner})`);
                const paid = await api('/api/story/settle', {
                    method: 'POST', token,
                    body: { playerName: player, kind: 'academySparring', runId },
                });
                if (check(paid.status === 200 && paid.body.ok === true, `the won spar settles → ${paid.status}`)) {
                    const won = paid.body.character ?? {};
                    check(Number(paid.body.statPoints ?? 0) === 20, `the teaching reward is +20 stat points (got ${paid.body.statPoints})`);
                    check(Number(won.ryo ?? 0) === Number(sparBase.ryo ?? 0) + 30, `+30 ryo (got ${won.ryo} from ${sparBase.ryo})`);
                    check(won.onboardingStep === 'cafeteria', `onboarding advances past the spar (got ${won.onboardingStep})`);
                    check(won.academySparClaimed === true, 'the one-time claim is latched');
                    // The whole point of a one-time grant: a second settle of the
                    // same run must replay, not pay again.
                    const again = await api('/api/story/settle', {
                        method: 'POST', token,
                        body: { playerName: player, kind: 'academySparring', runId },
                    });
                    const afterReplay = await api(`/api/save/${player}`, { token });
                    check(
                        again.status !== 200 || Number(afterReplay.body.character?.ryo ?? 0) === Number(won.ryo ?? 0),
                        'a repeat settle of the same run pays nothing further',
                    );
                }
            }
        }

        // Past the onboarding step, the spar cannot be opened at all — a fight
        // the settle would refuse must never be startable, because the outcome
        // report would still charge the player for it.
        await settleSaveBurst();
        const doneSave = await api(`/api/save/${player}`, { token });
        const advanced = await api(`/api/save/${player}`, {
            method: 'POST', token,
            body: {
                character: { ...(doneSave.body.character ?? {}), onboardingStep: 'cafeteria' },
                _baseSaveVersion: doneSave.body._saveVersion ?? 0,
            },
        });
        if (check(advanced.status === 200, `onboarding advanced → ${advanced.status}`)) {
            const late = await api('/api/story/spar-start', { method: 'POST', token, body: { playerName: player } });
            check(late.status === 409, `a spar past the onboarding step is refused → ${late.status}`);
        }
    }

    // 12 ── A real two-account PvP lifecycle. Unit tests cover the combat math;
    // this pins the integration seams that can still regress independently:
    // authoritative session creation, capability readback/reconnect, move-token
    // idempotency, terminal receipts, two-sided claims, and durable history.
    step('two-account PvP lifecycle');
    const observerToken = otherReg.body.token;
    const [p1Save, p2Save] = await Promise.all([
        api(`/api/save/${player}`, { token }),
        api(`/api/save/${other}`, { token: observerToken }),
    ]);
    const pvpChallengeId = `cert-ch-${suffix}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    const challengeSent = await api('/api/player/challenge', {
        method: 'POST', token, asName: player,
        body: {
            targetName: other,
            challenge: { id: pvpChallengeId, fromName: player, toName: other, createdAt: Date.now(), mode: 'standard' },
        },
    });
    check(challengeSent.status === 200, `authoritative PvP challenge created → ${challengeSent.status}`);
    const clientBattleId = `client-forged-${suffix}`;
    const createdPvp = await api('/api/pvp/session', {
        method: 'POST', token: observerToken, asName: other,
        body: {
            p1Character: p1Save.body.character ?? freshCharacter(player),
            p2Character: p2Save.body.character ?? freshCharacter(other),
            battleId: clientBattleId,
            challengeId: pvpChallengeId,
            biome: 'central',
            weatherPositiveElement: '',
            weatherNegativeElement: '',
            baseRewards: true,
            rewardSector: 0,
        },
    });
    if (check(createdPvp.status === 200 && !!createdPvp.body.battleId, `PvP session created → ${createdPvp.status}`)) {
        const battleId = String(createdPvp.body.battleId);
        let pvp = createdPvp.body.session;
        check(/^pvp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(battleId),
            'the battle uses a server-generated UUID v4 capability id');
        check(battleId !== clientBattleId, 'a client-supplied battle id is ignored');
        check(pvp?.p1?.name === player && pvp?.p2?.name === other, 'both authoritative saved fighters are sealed into the session');
        check(pvp?.baseRewards !== true, 'a standard challenge is sealed as a no-reward spar even if a client asks for base rewards');
        check(pvp?.rewardAuthority === 'challenge', 'the sanctioned duel is sealed to the single-use challenge receipt');

        const accepted = await api('/api/player/challenge', {
            method: 'POST', token: observerToken, asName: other,
            body: {
                targetName: player,
                challenge: { id: pvpChallengeId, fromName: other, toName: player, accepted: true, battleId },
            },
        });
        check(accepted.status === 200, `the exact challenged player accepts the exact bound battle → ${accepted.status}`);

        const joinedP1 = await api('/api/pvp/move', {
            method: 'POST', token, asName: player,
            body: { battleId, role: 'p1', action: 'join', moveToken: `cert-pvp-join-${suffix}`, playerName: player },
        });
        check(joinedP1.status === 200 && joinedP1.body.joined?.p1 === true && joinedP1.body.joined?.p2 === true,
            `both fighters authenticate into the sanctioned session → ${joinedP1.status}`);
        if (joinedP1.status === 200) pvp = joinedP1.body;

        const reconnected = await api(`/api/pvp/session?id=${encodeURIComponent(battleId)}`);
        check(reconnected.status === 200 && reconnected.body.battleId === battleId, `session reconnect/readback succeeds → ${reconnected.status}`);
        check(reconnected.body.round === pvp?.round && reconnected.body.activePlayer === pvp?.activePlayer,
            'reconnected state matches the session creation response');
        pvp = reconnected.body;

        // Apply one normal turn handoff, then replay the exact move token. The
        // second request must return the same state rather than advancing twice.
        const firstRole = pvp?.activePlayer;
        const firstIdentity = firstRole === 'p1'
            ? { name: player, token }
            : { name: other, token: observerToken };
        const handoffToken = `cert-pvp-handoff-${suffix}`;
        const handedOff = await api('/api/pvp/move', {
            method: 'POST', token: firstIdentity.token, asName: firstIdentity.name,
            body: { battleId, role: firstRole, action: 'wait', moveToken: handoffToken, playerName: firstIdentity.name },
        });
        if (check(handedOff.status === 200 && handedOff.body.activePlayer !== firstRole,
            `the active fighter can hand off the turn → ${handedOff.status}`)) {
            const replayedMove = await api('/api/pvp/move', {
                method: 'POST', token: firstIdentity.token, asName: firstIdentity.name,
                body: { battleId, role: firstRole, action: 'wait', moveToken: handoffToken, playerName: firstIdentity.name },
            });
            check(replayedMove.status === 200, `the move retry is accepted idempotently → ${replayedMove.status}`);
            check(
                replayedMove.body.activePlayer === handedOff.body.activePlayer
                    && replayedMove.body.round === handedOff.body.round
                    && replayedMove.body.actionsThisTurn === handedOff.body.actionsThisTurn,
                'replaying a move token cannot advance the battle twice',
            );
            pvp = replayedMove.body;
        } else if (handedOff.status === 200) {
            pvp = handedOff.body;
        }

        // Flee is intentionally a 50% roll. A failed attempt consumes the turn;
        // pass and let the next fighter try. Repeated failures also drain HP, so
        // this loop is bounded even in the vanishingly unlikely all-fail case.
        for (let attempt = 0; attempt < 24 && pvp?.status !== 'done'; attempt++) {
            const role = pvp.activePlayer;
            const fighter = role === 'p1'
                ? { name: player, token }
                : { name: other, token: observerToken };
            const fled = await api('/api/pvp/move', {
                method: 'POST', token: fighter.token, asName: fighter.name,
                body: {
                    battleId,
                    role,
                    action: 'flee',
                    moveToken: `cert-pvp-flee-${suffix}-${attempt}`,
                    playerName: fighter.name,
                },
            });
            if (fled.status !== 200) break;
            pvp = fled.body;
            if (pvp.status === 'done') break;

            const passed = await api('/api/pvp/move', {
                method: 'POST', token: fighter.token, asName: fighter.name,
                body: {
                    battleId,
                    role,
                    action: 'wait',
                    moveToken: `cert-pvp-pass-${suffix}-${attempt}`,
                    playerName: fighter.name,
                },
            });
            if (passed.status !== 200) break;
            pvp = passed.body;
        }

        if (check(pvp?.status === 'done' && (pvp?.winner === 'p1' || pvp?.winner === 'p2'),
            `the duel resolves authoritatively (winner ${pvp?.winner ?? 'missing'})`)) {
            const winner = pvp.winner === 'p1'
                ? { name: player, token }
                : { name: other, token: observerToken };
            const loser = pvp.winner === 'p1'
                ? { name: other, token: observerToken }
                : { name: player, token };
            const winnerBeforeClaim = await api(`/api/save/${winner.name}`, { token: winner.token });
            const beforeClaimRyo = Number(winnerBeforeClaim.body.character?.ryo ?? 0);
            const winnerClaim = await api('/api/pvp/claim-rewards', {
                method: 'POST', token: winner.token, asName: winner.name,
                body: { playerName: winner.name, battleId, outcome: 'win' },
            });
            check(winnerClaim.status === 200 && winnerClaim.body.ok === true && winnerClaim.body.alreadyClaimed === false,
                `the recorded winner settles exactly once → ${winnerClaim.status}`);
            check(winnerClaim.body.rewardAuthorized === true,
                'the claim confirms the single-use challenge authority and mutual join');
            const afterWinnerClaim = await api(`/api/save/${winner.name}`, { token: winner.token });
            const afterClaimRyo = Number(afterWinnerClaim.body.character?.ryo ?? 0);
            check(afterClaimRyo === beforeClaimRyo, `the no-reward spar cannot mint Ryo (${beforeClaimRyo} → ${afterClaimRyo})`);

            const forgedLoserWin = await api('/api/pvp/claim-rewards', {
                method: 'POST', token: loser.token, asName: loser.name,
                body: { playerName: loser.name, battleId, outcome: 'win' },
            });
            check(forgedLoserWin.status === 403,
                `a loser cannot claim the winner outcome → ${forgedLoserWin.status}`);

            const loserClaim = await api('/api/pvp/claim-rewards', {
                method: 'POST', token: loser.token, asName: loser.name,
                body: { playerName: loser.name, battleId, outcome: 'loss' },
            });
            check(loserClaim.status === 200 && loserClaim.body.ok === true && loserClaim.body.alreadyClaimed === false,
                `the recorded loser can settle their side → ${loserClaim.status}`);

            const duplicateClaim = await api('/api/pvp/claim-rewards', {
                method: 'POST', token: winner.token, asName: winner.name,
                body: { playerName: winner.name, battleId, outcome: 'win' },
            });
            const afterDuplicate = await api(`/api/save/${winner.name}`, { token: winner.token });
            check(duplicateClaim.status === 200 && duplicateClaim.body.alreadyClaimed === true,
                'replaying the winner claim reports alreadyClaimed');
            check(Number(afterDuplicate.body.character?.ryo ?? 0) === afterClaimRyo,
                'replaying the winner claim cannot change the no-reward settlement');

            for (const participant of [winner, loser]) {
                const history = await api('/api/pvp/combat-history?limit=20', {
                    token: participant.token, asName: participant.name,
                });
                check(
                    history.status === 200 && Array.isArray(history.body.entries)
                        && history.body.entries.some((entry) => entry?.battleId === battleId),
                    `${participant.name}'s durable combat history includes the duel`,
                );
            }

            const combatLog = await api(`/api/pvp/combat-log?id=${encodeURIComponent(battleId)}`, {
                token: winner.token, asName: winner.name,
            });
            check(combatLog.status === 200 && Array.isArray(combatLog.body.entries) && combatLog.body.entries.length > 0,
                `the participant can read durable action receipts → ${combatLog.status}`);
            const anonymousLog = await api(`/api/pvp/combat-log?id=${encodeURIComponent(battleId)}`);
            check(anonymousLog.status === 401, `durable combat receipts reject anonymous readers → ${anonymousLog.status}`);
        }
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

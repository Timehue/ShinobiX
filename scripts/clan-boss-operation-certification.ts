/**
 * Hermetic HTTP certification for the server-owned Clan Boss operation.
 *
 * Boots the real Express route graph against the explicit in-memory QA KV,
 * creates 1/2/4-player clans, then drives create/join, optimistic-concurrency
 * conflict, idempotent retry, ready, duplicate start, reconnect, terminal Tower
 * actions, concurrent settlement, and party cleanup over HTTP.
 *
 * This proves the protocol and single-process lock behavior. It deliberately
 * does not claim Postgres latency, packet loss, or cross-replica evidence; pass
 * --url in a future staging wrapper for those infrastructure measurements.
 */
import { randomBytes } from 'node:crypto';

const PORT = Number(process.argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length) ?? 42_731);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PASSWORD = `Operation-${randomBytes(12).toString('hex')}`;
const SUFFIX = randomBytes(3).toString('hex');

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.PORT = String(PORT);
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
process.env.ENABLE_CLAN_BOSS = '1';
process.env.DISABLE_SCHEDULED_JOBS = '1';
process.env.DISABLE_REALTIME = '1';
process.env.DISABLE_SNAPSHOT_CRON = '1';
process.env.SENTRY_DSN = '';

type Json = Record<string, any>;
type HttpResult = { status: number; body: Json };
type Player = { name: string; token: string };

const checks: Array<{ scenario: string; ok: boolean; detail: string }> = [];
let scenario = 'boot';
let requestCounter = 0;

function check(condition: unknown, detail: string): boolean {
    const ok = Boolean(condition);
    checks.push({ scenario, ok, detail });
    console.log(`[${ok ? ' ok ' : 'FAIL'}] ${scenario} — ${detail}`);
    return ok;
}

function requestId(prefix: string): string {
    requestCounter += 1;
    return `${prefix}-${SUFFIX}-${requestCounter}`;
}

async function http(path: string, input: { method?: string; body?: unknown; token?: string } = {}): Promise<HttpResult> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (input.token) headers['x-player-token'] = input.token;
    const response = await fetch(`${BASE}${path}`, {
        method: input.method ?? 'GET',
        headers,
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) as Json };
}

async function waitForHealth(timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE}/health`)).ok) return true;
        } catch { /* server is still starting */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
}

function certificationCharacter(name: string, clan: string): Json {
    const stats = {
        strength: 40, speed: 40, intelligence: 40, willpower: 40,
        bukijutsuOffense: 40, bukijutsuDefense: 40,
        taijutsuOffense: 40, taijutsuDefense: 40,
        genjutsuOffense: 40, genjutsuDefense: 40,
        ninjutsuOffense: 40, ninjutsuDefense: 40,
    };
    return {
        name, clan, village: 'Ember', level: 40, specialty: 'Ninjutsu', profession: 'healer',
        hp: 120, maxHp: 120, chakra: 400, maxChakra: 400, stamina: 400, maxStamina: 400,
        stats, equipment: {}, inventory: [], itemStacks: [], pets: [], jutsu: [],
        equippedJutsuIds: [], jutsuMastery: [], ryo: 100,
    };
}

async function registerPlayers(count: number, clan: string, kv: Json): Promise<Player[]> {
    const players: Player[] = [];
    for (let index = 0; index < count; index += 1) {
        const name = `op${count}p${index}${SUFFIX}`.slice(0, 20);
        const password = `Operation-${index}-${SUFFIX}A1!`;
        const registered = await http('/api/player-auth', { method: 'POST', body: { action: 'register', name, password } });
        if (!check(registered.status === 200 && typeof registered.body.token === 'string', `${name} registers with token auth`)) continue;
        players.push({ name, token: String(registered.body.token) });
        await kv.set(`save:${name}`, { character: certificationCharacter(name, clan), _saveVersion: 1, updatedAt: Date.now() });
    }
    await kv.set(`save:clan-${clan.toLowerCase().replace(/[^a-z0-9]/g, '')}`, {
        name: clan,
        members: players.map((player) => ({ name: player.name, level: 40, role: player === players[0] ? 'leader' : 'member' })),
        treasury: { ryo: 0, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0 },
    });
    return players;
}

async function partyGet(player: Player): Promise<HttpResult> {
    return http(`/api/clan-boss/party?playerName=${encodeURIComponent(player.name)}`, { token: player.token });
}

async function partyPost(player: Player, body: Json): Promise<HttpResult> {
    return http('/api/clan-boss/party', { method: 'POST', token: player.token, body: { playerName: player.name, ...body } });
}

async function runScenario(size: 1 | 2 | 4, kv: Json): Promise<void> {
    scenario = `${size}-player operation`;
    const clan = `Roundness ${size} ${SUFFIX}`;
    const players = await registerPlayers(size, clan, kv);
    if (!check(players.length === size, `${size} authenticated member(s) seeded`)) return;

    const created = await partyPost(players[0]!, { action: 'create', requestId: requestId('create'), visibility: size === 1 ? 'private' : 'public' });
    if (!check(created.status === 200 && created.body.party?.members?.length === 1, 'leader creates a server-owned party')) return;
    let party = created.body.party as Json;

    for (const player of players.slice(1)) {
        const joined = await partyPost(player, { action: 'join', requestId: requestId('join'), partyId: party.id, expectedVersion: party.version });
        if (!check(joined.status === 200, `${player.name} joins through the party protocol`)) return;
        party = joined.body.party;
    }
    check(party.members.length === size, `party contains exactly ${size} real member(s)`);

    if (size === 4) {
        const version = party.version;
        const firstId = requestId('race-ready-a');
        const secondId = requestId('race-ready-b');
        const raced = await Promise.all([
            partyPost(players[0]!, { action: 'ready', requestId: firstId, partyId: party.id, expectedVersion: version }),
            partyPost(players[1]!, { action: 'ready', requestId: secondId, partyId: party.id, expectedVersion: version }),
        ]);
        check(raced.filter((result) => result.status === 200).length === 1, 'same-version concurrent ready has one winner');
        check(raced.filter((result) => result.status === 409 && result.body.errorCode === 'version-conflict').length === 1, 'stale concurrent ready fails with a version conflict');
        const winnerIndex = raced.findIndex((result) => result.status === 200);
        const replayed = await partyPost(players[winnerIndex]!, {
            action: 'ready', requestId: winnerIndex === 0 ? firstId : secondId, partyId: party.id, expectedVersion: version,
        });
        check(replayed.status === 200, 'a lost-response retry replays before version validation');
        party = replayed.body.party;
    }

    for (const player of players) {
        if (party.members.find((member: Json) => member.slug === player.name)?.ready) continue;
        const readied = await partyPost(player, { action: 'ready', requestId: requestId('ready'), partyId: party.id, expectedVersion: party.version });
        if (!check(readied.status === 200, `${player.name} seals an authoritative loadout snapshot`)) return;
        party = readied.body.party;
    }
    check(party.allReady === true, 'server projects the party as all-ready');

    for (const player of players) {
        const reconnected = await partyGet(player);
        check(reconnected.status === 200 && reconnected.body.party?.id === party.id, `${player.name} reconnects to the same party`);
        party = reconnected.body.party;
    }

    const startId = requestId('start');
    const startBody = { hostName: players[0]!.name, partyId: party.id, expectedVersion: party.version, requestId: startId, hostLoadout: {} };
    const starts = await Promise.all([
        http('/api/clan-boss/assault-start', { method: 'POST', token: players[0]!.token, body: startBody }),
        http('/api/clan-boss/assault-start', { method: 'POST', token: players[0]!.token, body: startBody }),
    ]);
    if (!check(starts.every((result) => result.status === 200), 'duplicate start requests both resolve successfully')) return;
    const runId = String(starts[0]!.body.runId ?? '');
    if (!check(runId.startsWith('cboss-') && starts[1]!.body.runId === runId, 'duplicate start reserves one attempt and one run')) return;
    let session = starts[0]!.body.session as Json;

    let actions = 0;
    let reconnects = 0;
    while (session?.status === 'active' && actions < 180) {
        const actorId = session.turnQueue?.[session.activeIndex];
        const actor = session.actors?.find((entry: Json) => entry.id === actorId);
        const owner = players.find((player) => player.name === actor?.ownerSlug);
        if (!owner) {
            const refreshed = await http(`/api/towers/state?runId=${encodeURIComponent(runId)}&playerName=${encodeURIComponent(players[0]!.name)}`, { token: players[0]!.token });
            if (refreshed.status !== 200) break;
            session = refreshed.body.session;
            continue;
        }
        const acted = await http('/api/towers/action', {
            method: 'POST', token: owner.token, body: { runId, playerName: owner.name, type: 'wait' },
        });
        if (!check(acted.status === 200 && acted.body.applied === true, `${owner.name} submits authoritative action ${actions + 1}`)) return;
        session = acted.body.session;
        actions += 1;
        if (actions % 2 === 0 && session.status === 'active') {
            const reconnecting = players[reconnects % players.length]!;
            const refreshed = await http(`/api/towers/state?runId=${encodeURIComponent(runId)}&playerName=${encodeURIComponent(reconnecting.name)}`, { token: reconnecting.token });
            if (!check(refreshed.status === 200 && refreshed.body.session?.runId === runId, `${reconnecting.name} refreshes the shared run`)) return;
            session = refreshed.body.session;
            reconnects += 1;
        }
    }
    if (!check(session?.status === 'done', `real Tower engine reaches a terminal state after ${actions} human actions`)) return;

    const settlements = await Promise.all(players.slice(0, Math.min(2, players.length)).map((player) =>
        http('/api/clan-boss/assault-settle', { method: 'POST', token: player.token, body: { runId, playerName: player.name } })));
    check(settlements.every((result) => result.status === 200 && result.body.ok === true), 'concurrent settlement callers both receive the authoritative result');
    if (settlements.length > 1) check(settlements.some((result) => result.body.alreadySettled === true), 'one concurrent settlement is explicitly idempotent');

    const after = await partyGet(players[0]!);
    check(after.status === 200 && after.body.party === null, 'terminal settlement releases the player→party index');
}

async function main(): Promise<void> {
    let server: import('node:http').Server | null = null;
    try {
        const [{ kv }, bossStorage, serverModule] = await Promise.all([
            import('../api/_storage.js'),
            import('../api/clan-boss/_storage.js'),
            import('../server.js'),
        ]);
        server = serverModule.server;
        if (!check(await waitForHealth(), `${BASE}/health responds`)) throw new Error('server failed to start');
        const now = Date.now();
        const weekId = bossStorage.clanBossWeekId(now);
        await kv.set(bossStorage.clanBossWeekKey(weekId), {
            weekId, bossId: 'oni-warlord', spawnedAt: now - 1_000, endsAt: now + 24 * 60 * 60 * 1000,
        });
        for (const size of [1, 2, 4] as const) await runScenario(size, kv);
    } catch (error) {
        check(false, error instanceof Error ? error.stack ?? error.message : String(error));
    } finally {
        if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }

    const failures = checks.filter((entry) => !entry.ok);
    console.log(`\nClan Boss operation certification: ${checks.length - failures.length}/${checks.length} checks passed.`);
    if (failures.length) {
        for (const failure of failures) console.error(` - ${failure.scenario}: ${failure.detail}`);
        process.exitCode = 1;
    }
}

void main();

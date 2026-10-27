/** Low-volume four-account Tower certification. The default credential file is ignored.
 * --prepare creates four ordinary disposable accounts; --run requires saved level 30+.
 * Remote mutations require the exact --confirm-origin, never follow redirects, and
 * target only the four qa-prefixed identities created by this runner.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { TowerSession } from '../../api/towers/_tower-session.js';

const args = process.argv.slice(2);
const option = (name: string, fallback = '') => args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? fallback;
const target = new URL(option('--url', 'http://127.0.0.1:15389'));
if (target.pathname !== '/' || target.username || target.password || target.search || target.hash) throw new Error('Use an origin without credentials or paths.');
const local = ['127.0.0.1', 'localhost'].includes(target.hostname);
if (!local && (target.protocol !== 'https:' || option('--confirm-origin') !== target.origin)) throw new Error('Remote testing requires --confirm-origin=<exact HTTPS origin>.');
const mode = args.includes('--prepare') ? 'prepare' : args.includes('--run') ? 'run' : 'preflight';
const coordinated = args.includes('--coordinated');
const expectedWinner = option('--expect-winner');
if (expectedWinner && !['squad', 'enemy'].includes(expectedWinner)) throw new Error('Expected winner must be squad or enemy.');
const storyFloor = Number(option('--floor', '1'));
if (!Number.isInteger(storyFloor) || storyFloor < 1 || storyFloor > 15) throw new Error('Story floor must be an integer from 1 to 15.');
const storyRoute = option('--route', 'rest-shrine');
if (!['rest-shrine', 'focused-assault', 'elite-shortcut'].includes(storyRoute)) throw new Error('Story route must be rest-shrine, focused-assault or elite-shortcut.');
const accountsFile = resolve(option('--accounts-file', '.tmp/tower-live-accounts.json'));
const outputFile = resolve(option('--output', '.tmp/tower-live-report.json'));
type Account = { name: string; password: string; token?: string; initialized?: boolean };
type CredentialFile = { purpose: string; origin: string; accounts: Account[] };
const report: any = { origin: target.origin, mode, floor: storyFloor, route: storyRoute,
    controller: coordinated ? 'coordinated-catalog' : 'shipped-ai',
    startedAt: new Date().toISOString(), checks: [], requests: 0, socketEvents: [], status: 'running' };
const sockets: Socket[] = [];
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const saveReport = () => { mkdirSync(dirname(outputFile), { recursive: true }); writeFileSync(outputFile, JSON.stringify(report, null, 2)); };
function check(name: string, passed: boolean, detail?: unknown) {
    report.checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
    saveReport();
}
function requireCheck(name: string, passed: boolean, detail?: unknown): asserts passed {
    check(name, passed, detail); if (!passed) throw new Error(name);
}
async function request(path: string, account?: Account, body?: object, dropBody = false) {
    if (report.requests >= 650) throw new Error('Request budget exhausted.');
    report.requests++;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body) headers['content-type'] = 'application/json';
    if (account) {
        if (!/^qatw[a-f0-9]{10}[0-3]$/.test(account.name)) throw new Error('Refusing a non-test account.');
        headers['x-player-name'] = account.name;
        headers['x-player-token'] = account.token ?? '';
    }
    let response: Response;
    try {
        response = await fetch(new URL(path, target), { method: body ? 'POST' : 'GET', headers,
            ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(20000) });
    } catch (error) {
        const cause = error instanceof Error ? error.cause : undefined;
        const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code)
            : error instanceof Error ? error.name : 'unknown';
        (report.transportErrors ??= []).push({ path: path.split('?')[0], method: body ? 'POST' : 'GET', code });
        throw new Error(`${path.split('?')[0]} transport failed (${code})`);
    }
    const refreshed = response.headers.get('x-player-token-refresh');
    if (refreshed && account) account.token = refreshed;
    if (dropBody) { await response.body?.cancel(); return { status: response.status, body: null as any }; }
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('Response exceeded certification budget.');
    let value: any; try { value = text ? JSON.parse(text) : {}; } catch { throw new Error(`${path.split('?')[0]} returned non-JSON HTTP ${response.status}`); }
    return { status: response.status, body: value };
}
const version = (session: TowerSession) => Number((session as any).actionVersion ?? 0);
const statePath = (runId: string, account: Account) => `/api/towers/state?runId=${encodeURIComponent(runId)}&playerName=${account.name}`;
function credentialFile(): CredentialFile {
    const file = JSON.parse(readFileSync(accountsFile, 'utf8')) as CredentialFile;
    if (file.origin !== target.origin || file.purpose !== 'tower-multiplayer-certification' || file.accounts.length !== 4
        || new Set(file.accounts.map(account => account.name)).size !== 4
        || file.accounts.some(account => !/^qatw[a-f0-9]{10}[0-3]$/.test(account.name))) throw new Error('Invalid disposable account file.');
    return file;
}
function writeCredentials(file: CredentialFile) {
    mkdirSync(dirname(accountsFile), { recursive: true });
    writeFileSync(accountsFile, JSON.stringify(file, null, 2), { mode: 0o600 });
}
async function connectClients(accounts: Account[]) {
    for (const account of accounts) {
        const presence = { sector: 40, displayName: account.name, character: null };
        const socket = io(target.origin, { forceNew: true, autoConnect: false, transports: ['websocket'],
            reconnectionDelay: 500, reconnectionDelayMax: 2000, timeout: 15000,
            auth: { 'x-player-name': account.name, 'x-player-token': account.token, 'x-client-fp': `tower-cert-${account.name}`, presenceBatch: 1, presence } });
        socket.on('tower:kick', kick => {
            if (report.socketEvents.length < 256) report.socketEvents.push({ player: account.name, channel: kick?.channel, reason: kick?.reason, version: kick?.actionVersion ?? kick?.version });
        });
        sockets.push(socket);
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), 20000);
            socket.once('connect', () => { clearTimeout(timer); socket.emit('presence', presence); resolve(); });
            socket.once('connect_error', () => { clearTimeout(timer); reject(new Error('Socket connection rejected.')); });
            socket.connect();
        });
    }
    check('four distinct authenticated websocket clients connected', sockets.every(socket => socket.connected));
    const started = Date.now();
    const reconnected = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Transport reconnect timed out.')), 15000);
        sockets[2]!.once('connect', () => { clearTimeout(timer); resolve(); });
    });
    sockets[2]!.io.engine.close();
    await reconnected;
    requireCheck('forced websocket transport loss reconnects', Date.now() - started < 5000, { latencyMs: Date.now() - started });
}
async function closeFormingRooms(accounts: Account[]) {
    for (const account of accounts) {
        const current = await request(`/api/towers/party?playerName=${account.name}`, account);
        const party = current.body.party;
        if (party?.status === 'forming') await request('/api/towers/party', account, { playerName: account.name, action: 'leave', partyId: party.id,
            expectedVersion: party.version, requestId: randomUUID() });
    }
}
async function readSave(account: Account) {
    const response = await request(`/api/save/${account.name}`, account);
    if (response.status !== 200 || !response.body.character) throw new Error(`Disposable save unavailable: ${account.name}`);
    return response.body;
}
async function certifyRun(accounts: Account[]) {
    const { activeActor } = await import('../../api/towers/_tower-session.js');
    const { pickAiAction } = await import('../../api/towers/_engine.js');
    const coordinatedAction = coordinated ? (await import('../../scripts/spire-balance-sim.js')).smartSquadAction : undefined;
    const saves = await Promise.all(accounts.map(readSave));
    requireCheck('all four test accounts meet level 30', saves.every(save => Number(save.character.level) >= 30),
        saves.map((save, index) => ({ player: accounts[index]!.name, level: save.character.level })));
    await closeFormingRooms(accounts);
    await connectClients(accounts);
    const mutation = async (account: Account, body: object) => request('/api/towers/party', account, { ...body, playerName: account.name, requestId: randomUUID() });
    const created = await mutation(accounts[0]!, { action: 'create', mode: 'story', floor: storyFloor, routeChoice: storyRoute });
    requireCheck('host creates a private Story ready room', created.status === 200 && !!created.body.party, { status: created.status });
    let party = created.body.party;
    report.partyId = party.id;
    for (const account of accounts.slice(1)) {
        const joined = await mutation(account, { action: 'join', inviteCode: party.inviteCode, expectedVersion: party.version });
        requireCheck(`${account.name} joins the shared room`, joined.status === 200 && !!joined.body.party, { status: joined.status });
        party = joined.body.party;
    }
    for (const account of accounts) {
        const ready = await mutation(account, { action: 'ready', partyId: party.id, expectedVersion: party.version });
        requireCheck(`${account.name} readies`, ready.status === 200 && !!ready.body.party, { status: ready.status });
        party = ready.body.party;
    }
    const launchBody = { hostName: accounts[0]!.name, mode: 'story', floor: storyFloor, partyId: party.id, expectedVersion: party.version, requestId: randomUUID() };
    const launch = await request('/api/towers/start', accounts[0], launchBody);
    requireCheck('one run launches with four live actors', launch.status === 200 && launch.body.session?.actors.filter((actor: any) => actor.side === 'squad' && !actor.ai).length === 4,
        { status: launch.status, errorCode: launch.body.errorCode, requiredLevel: launch.body.requiredLevel });
    const runId = launch.body.runId as string;
    report.runId = runId;
    let session = launch.body.session as TowerSession;
    report.sealedSquad = accounts.map((account, index) => {
        const actor = session.actors.find(candidate => candidate.side === 'squad' && candidate.ownerSlug === account.name);
        const equipment = saves[index]!.character.equipment ?? {};
        const sealedEquipment = (actor?.character.equipment ?? {}) as Record<string, string>;
        const items = (actor?.character.pvpItems ?? []) as Array<{ id: string; weaponEp?: number }>;
        return { player: account.name, savedLevel: saves[index]!.character.level, sealedLevel: actor?.character.level,
            equipment: sealedEquipment, armorRawDR: actor?.character.armorRawDR, itemDamagePct: actor?.character.itemDamagePct,
            weapon: items.find(item => item.id === equipment.hand && Number(item.weaponEp) > 0),
            gearRetained: !!actor && Number(actor.character.level) === Number(saves[index]!.character.level)
                && Object.values(equipment as Record<string, string>).every(id => Object.values(sealedEquipment).includes(id))
                && (!equipment.hand || items.some(item => item.id === equipment.hand && Number(item.weaponEp) > 0)) };
    });
    requireCheck('saved levels and equipped gear survive authoritative combat sealing', report.sealedSquad.every((actor: any) => actor.gearRetained));
    const launchReplay = await request('/api/towers/start', accounts[0], launchBody);
    requireCheck('lost launch acknowledgement recovers the same run', launchReplay.status === 200 && launchReplay.body.runId === runId, { status: launchReplay.status });
    const project = (state: TowerSession) => JSON.stringify({ version: version(state), actors: state.actors, queue: state.turnQueue, index: state.activeIndex,
        ap: state.activeAp, actions: state.actionsThisTurn, round: state.round, status: state.status, winner: state.winner });
    const synchronize = async () => {
        const views = await Promise.all(accounts.map(account => request(statePath(runId, account), account)));
        requireCheck('all four clients converge on one authoritative board', views.every(view => view.status === 200 && project(view.body.session) === project(views[0]!.body.session)),
            { views: views.map((view, index) => ({ player: accounts[index]!.name, status: view.status,
                errorCode: view.body.errorCode, version: view.body.session ? version(view.body.session) : undefined })) });
        session = views[0]!.body.session;
    };
    await synchronize();
    for (const account of accounts) {
        const joined = await request('/api/towers/join', account, { runId, playerName: account.name, loadout: { maxHp: 999999 } });
        requireCheck(`${account.name} reconnect preserves its sealed actor`, joined.status === 200 && project(joined.body.session) === project(session));
    }
    const owner = accounts.find(account => account.name === activeActor(session)?.ownerSlug)!;
    const other = accounts.find(account => account !== owner)!;
    const command = { runId, type: 'wait', expectedVersion: version(session), moveToken: randomUUID() };
    const refused = await request('/api/towers/action', other, { ...command, playerName: other.name });
    requireCheck('another member cannot take the active turn', refused.status === 409 && refused.body.reason === 'not-your-turn');
    const dropped = await request('/api/towers/action', owner, { ...command, playerName: owner.name }, true);
    requireCheck('committed action response can be lost without rejecting the write', dropped.status === 200);
    const replay = await request('/api/towers/action', owner, { ...command, playerName: owner.name });
    requireCheck('retry after discarded response advances exactly once', replay.status === 200 && replay.body.replayed === true && version(replay.body.session) === version(session) + 1);
    session = replay.body.session;
    const stale = await request('/api/towers/action', accounts.find(account => account.name === activeActor(session)?.ownerSlug),
        { runId, playerName: activeActor(session)?.ownerSlug, type: 'wait', expectedVersion: version(session) - 1, moveToken: randomUUID() });
    requireCheck('stale commands cannot overwrite newer combat', stale.body.applied === false && stale.body.reason === 'stale-version');
    console.log('Waiting for the real 75-second AFK deadline.');
    const afkBefore = version(session);
    await sleep(Math.max(0, Number(session.turnStartedAt) + 76_000 - Date.now()));
    const afterAfk = await request(statePath(runId, other), other);
    requireCheck('an absent human turn passes and the run remains recoverable', afterAfk.status === 200 && version(afterAfk.body.session) > afkBefore
        && afterAfk.body.session.log.some((line: string) => line.includes('was away')));
    session = afterAfk.body.session;
    await synchronize();
    let acceptedActions = 0;
    const controllers = new Set<string>();
    // Upper-floor waves and support actions need more turns than the entry
    // scenario. This remains within the independent 650-request hard budget.
    while (session.status === 'active' && acceptedActions < 360) {
        const actor = activeActor(session);
        const account = accounts.find(account => account.name === actor?.ownerSlug);
        if (!actor || !account) throw new Error('No live controller for active turn.');
        const planned = coordinatedAction ? coordinatedAction(session, actor, true) : pickAiAction(session, actor, () => .5);
        const action = await request('/api/towers/action', account, { ...planned, runId, playerName: account.name,
            expectedVersion: version(session), moveToken: randomUUID() });
        if (action.status !== 200 || !action.body.applied) throw new Error(`Legal combat action rejected: ${action.status} ${action.body.reason ?? action.body.errorCode ?? 'unknown'}`);
        controllers.add(account.name); acceptedActions++; session = action.body.session;
        if (acceptedActions % 20 === 0) { console.log(`Combat: ${acceptedActions} actions, round ${session.round}`); await synchronize(); }
        await sleep(350);
    }
    report.combat = { acceptedActions, controllers: [...controllers], winner: session.winner, rounds: session.round };
    requireCheck('all four accounts submit legal combat actions', controllers.size === 4);
    requireCheck('normal combat reaches a terminal result', session.status === 'done', { actions: acceptedActions, winner: session.winner, rounds: session.round });
    const summoned = [...session.actors, ...(session.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)].filter(actor => actor.id.startsWith('add-'));
    report.reinforcements = summoned.map(actor => ({ id: actor.id, maxHp: actor.maxHp,
        damageScale: actor.character.towerDmgScale, mastery: actor.character.jutsuMastery }));
    if (args.includes('--expect-reinforcements')) requireCheck('phase reinforcements actually entered the tested run', summoned.length > 0);
    if (expectedWinner) requireCheck('combat reaches the requested outcome', session.winner === expectedWinner);
    await synchronize();
    const settle = async (account: Account) => {
        for (let attempt = 0; attempt < 8; attempt++) {
            const response = await request('/api/towers/settle', account, { runId, playerName: account.name });
            if (response.status === 200 && response.body.settled === true) return response;
            if (![200, 409, 503].includes(response.status)) throw new Error(`Settlement failed HTTP ${response.status}`);
            await sleep(1250);
        }
        throw new Error('Settlement did not finalize within retry budget.');
    };
    const receipts = await Promise.all(accounts.map(settle));
    requireCheck('four concurrent settlement callers reach confirmed receipts', receipts.every(receipt => receipt.body.settled === true));
    const paid = await Promise.all(accounts.map(readSave));
    report.settlement = accounts.map((account, index) => ({ player: account.name,
        result: receipts[index]!.body.results?.[account.name], ryoDelta: Number(paid[index]!.character.ryo) - Number(saves[index]!.character.ryo) }));
    if (session.winner === 'squad') {
        const firstClears = saves.map((save, index) => ({ save, index })).filter(({ save }) => !save.character.battleTowerClearedFloors?.includes(storyFloor));
        requireCheck('winning members retain their confirmed floor clear', paid.every(save => save.character.battleTowerClearedFloors?.includes(storyFloor)));
        if (firstClears.length) requireCheck('every fresh first clear receives its currency reward', firstClears.every(({ save, index }) => Number(paid[index]!.character.ryo) > Number(save.character.ryo)));
    }
    await settle(accounts[0]!);
    const replayed = await Promise.all(accounts.map(readSave));
    const economicState = (save: any) => JSON.stringify({ ryo: save.character.ryo, cleared: save.character.battleTowerClearedFloors,
        rating: save.character.battleTowerRating, fate: save.character.fateShards, stats: save.character.stats, unspent: save.character.unspentStats });
    requireCheck('reward retry changes no currency or progression twice', paid.every((save, index) => economicState(save) === economicState(replayed[index])));
    const rooms = await Promise.all(accounts.map(account => request(`/api/towers/party?playerName=${account.name}`, account)));
    requireCheck('settlement releases every party member', rooms.every(room => !room.body.party || room.body.party.status === 'closed'));
    requireCheck('every websocket received Tower revision hints', accounts.every(account => report.socketEvents.some((event: any) => event.player === account.name && event.channel === 'session')));
}

try {
    // Validate all arguments before loading game content, then finish that work
    // before opening HTTP keep-alive connections or starting a human-turn clock.
    if (mode === 'prepare') await import('../src/lib/create-character.js');
    if (mode === 'run') {
        await import('../../api/towers/_tower-session.js');
        await import('../../api/towers/_engine.js');
        if (coordinated) await import('../../scripts/spire-balance-sim.js');
    }
    const health = await request('/health');
    requireCheck('live shallow health', health.status === 200 && health.body.ok === true, health.body);
    report.commit = health.body.commit;
    const catalog = await request('/api/towers/floors');
    requireCheck('all fifteen Story floors are publicly readable', catalog.status === 200 && catalog.body.floors?.length === 15);
    report.catalogHasNewBalance = catalog.body.floors?.[0]?.recommendedPartySize === 4;
    if (mode === 'prepare') {
        const { createCharacter } = await import('../src/lib/create-character.js');
        const recovering = existsSync(accountsFile);
        const file: CredentialFile = recovering ? credentialFile() : {
            purpose: 'tower-multiplayer-certification', origin: target.origin,
            accounts: Array.from({ length: 4 }, (_, index) => ({ name: `qatw${randomBytes(5).toString('hex')}${index}`, password: `${randomBytes(18).toString('base64url')}Aa1!` })),
        };
        writeCredentials(file);
        const levels: number[] = [];
        for (const account of file.accounts) {
            // A previous registration may have committed before its acknowledgement
            // was lost. Verify our generated password before retrying that claim.
            let registered = await request('/api/player-auth', undefined, { action: recovering || account.token ? 'verify' : 'register', name: account.name, password: account.password });
            if (recovering && !account.token && registered.status === 200 && registered.body.ok === false) {
                registered = await request('/api/player-auth', undefined, { action: 'register', name: account.name, password: account.password });
            }
            requireCheck(`${account.name} authenticates`, registered.status === 200 && registered.body.ok === true && !!registered.body.token,
                { status: registered.status, ...(registered.body.error ? { error: registered.body.error } : {}) });
            account.token = registered.body.token; writeCredentials(file);
            if (!account.initialized) {
                const existing = await request(`/api/save/${account.name}`, account);
                if (existing.status === 404) {
                    const character = createCharacter(account.name, 'Ashen Leaf', 'Ninjutsu', 'Ashen Eyes');
                    const saved = await request(`/api/save/${account.name}`, account, { character, currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: [], _baseSaveVersion: 0 });
                    requireCheck(`${account.name} receives a canonical first save`, saved.status === 200, { status: saved.status });
                } else requireCheck(`${account.name} recovers its existing save`, existing.status === 200 && !!existing.body.character);
                account.initialized = true; writeCredentials(file);
            }
            const saved = await readSave(account);
            levels.push(Number(saved.character.level));
            check(`${account.name} ordinary level is recorded`, Number(saved.character.level) >= 1, { level: saved.character.level });
        }
        report.accounts = file.accounts.map(account => account.name);
        await connectClients(file.accounts);
        if (levels[0]! < 30) {
            const probe = await request('/api/towers/party', file.accounts[0], { playerName: file.accounts[0]!.name, action: 'create', mode: 'story', floor: 1, requestId: randomUUID() });
            check('under-level ready-room admission requires level 30', probe.status === 403 && probe.body.requiredLevel === 30,
                { status: probe.status, errorCode: probe.body.errorCode, requiredLevel: probe.body.requiredLevel });
            if (probe.body.party) report.unexpectedPartyId = probe.body.party.id;
        }
        await closeFormingRooms(file.accounts);
        report.combatPending = levels.every(level => level >= 30) ? 'Accounts are eligible for --run.' : 'Four accounts must be legitimately prepared at level 30 before --run.';
        writeCredentials(file);
    } else if (mode === 'run') {
        const file = credentialFile(); report.accounts = file.accounts.map(account => account.name);
        await certifyRun(file.accounts); writeCredentials(file);
    }
    const healthAfter = await request('/health');
    requireCheck('deployed commit remains stable during the test', healthAfter.body.commit === report.commit, { before: report.commit, after: healthAfter.body.commit });
    report.status = report.checks.every((entry: any) => entry.passed) ? 'passed' : 'findings';
    if (report.status === 'findings') process.exitCode = 1;
} catch (error) {
    report.status = 'failed'; report.error = error instanceof Error ? error.message : 'Unexpected error';
    console.error(report.error); process.exitCode = 1;
} finally {
    for (const socket of sockets) socket.disconnect();
    report.finishedAt = new Date().toISOString(); saveReport();
    console.log(`Report: ${outputFile}`);
}

import { expect, test, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';

const BASE_URL = 'http://127.0.0.1:4183';
const ADMIN_PASSWORD = 'live-express-e2e-admin';

type Account = { name: string; token: string };
type PresencePlayer = { name?: string; displayName?: string; tile?: number };
type PresenceSnapshot = { sector?: number; players?: PresencePlayer[] };

function canonical(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function eventOnce<T>(socket: Socket, event: string, timeoutMs = 15_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, onEvent);
            reject(new Error(`Timed out waiting for Socket.IO event ${event}`));
        }, timeoutMs);
        const onEvent = (payload: T) => {
            clearTimeout(timeout);
            socket.off(event, onEvent);
            resolve(payload);
        };
        socket.on(event, onEvent);
    });
}

async function registerAndSeed(request: APIRequestContext, name: string): Promise<Account> {
    const password = 'Realtime!Pass1234';
    const registration = await request.post('/api/player-auth', {
        data: { action: 'register', name, password },
    });
    expect(registration.status()).toBe(200);
    const token = String((await registration.json()).token ?? '');
    expect(token.length).toBeGreaterThan(10);

    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': ADMIN_PASSWORD },
        data: {
            character: {
                name,
                village: 'Ember',
                specialty: 'Ninjutsu',
                bloodline: 'None',
                level: 1,
                rankTitle: 'Academy Student',
                ryo: 100,
                hp: 100,
                maxHp: 100,
                chakra: 100,
                maxChakra: 100,
                stamina: 100,
                maxStamina: 100,
                onboardingStep: 'done',
                stats: {
                    strength: 10, speed: 10, intelligence: 10, willpower: 10,
                    bukijutsuOffense: 10, bukijutsuDefense: 10,
                    taijutsuOffense: 10, taijutsuDefense: 10,
                    genjutsuOffense: 10, genjutsuDefense: 10,
                    ninjutsuOffense: 10, ninjutsuDefense: 10,
                },
                inventory: [], equipment: {}, pets: [], jutsuMastery: [], equippedJutsuIds: [],
            },
            currentSector: 40,
            acceptedMissionIds: [],
            missionProgress: {},
            triggeredEvents: [],
        },
    });
    expect(seeded.status()).toBe(200);
    return { name, token };
}

function connectAccount(account: Account, fingerprint: string): Socket {
    return io(BASE_URL, {
        autoConnect: false,
        forceNew: true,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 100,
        reconnectionDelayMax: 500,
        timeout: 10_000,
        auth: {
            'x-player-name': account.name,
            'x-player-token': account.token,
            'x-client-fp': fingerprint,
            presence: {
                sector: 40,
                displayName: account.name,
                character: { name: account.name, level: 1, village: 'Ember' },
                tile: 60,
            },
        },
    });
}

async function connectAndSnapshot(socket: Socket): Promise<PresenceSnapshot> {
    const connected = eventOnce<void>(socket, 'connect');
    const snapshot = eventOnce<PresenceSnapshot>(socket, 'presence:sector');
    socket.connect();
    await connected;
    return snapshot;
}

async function sectorNames(socket: Socket): Promise<string[]> {
    const next = eventOnce<PresenceSnapshot>(socket, 'presence:sector');
    socket.emit('presence:request', { sector: 40 });
    const snapshot = await next;
    return (snapshot.players ?? []).map((player) => canonical(player.name ?? player.displayName));
}

test('two authenticated accounts remain cross-visible through movement and a transport reconnect', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop-live', 'one built-server run covers the realtime authority seam');
    const suffix = `${Date.now().toString(36)}${testInfo.workerIndex}`.slice(-9);
    const [alpha, bravo] = await Promise.all([
        registerAndSeed(request, `rtalpha${suffix}`),
        registerAndSeed(request, `rtbravo${suffix}`),
    ]);
    const alphaSocket = connectAccount(alpha, `live-e2e-alpha-${suffix}`);
    const bravoSocket = connectAccount(bravo, `live-e2e-bravo-${suffix}`);
    const connectErrors: string[] = [];
    alphaSocket.on('connect_error', (error) => connectErrors.push(`alpha: ${error.message}`));
    bravoSocket.on('connect_error', (error) => connectErrors.push(`bravo: ${error.message}`));

    try {
        await connectAndSnapshot(alphaSocket);
        await connectAndSnapshot(bravoSocket);

        await expect.poll(() => sectorNames(alphaSocket)).toEqual(expect.arrayContaining([alpha.name, bravo.name]));
        await expect.poll(() => sectorNames(bravoSocket)).toEqual(expect.arrayContaining([alpha.name, bravo.name]));

        const moved = eventOnce<{ name?: string; tile?: number }>(bravoSocket, 'presence:move');
        alphaSocket.emit('presence:move', { tile: 61 });
        await expect(moved).resolves.toMatchObject({ name: alpha.name, tile: 61 });

        const disconnected = eventOnce<string>(alphaSocket, 'disconnect');
        const reconnected = eventOnce<void>(alphaSocket, 'connect');
        // Close only the active transport. The Manager remains alive, exactly
        // matching a transient mobile network loss rather than an intentional
        // logout, so its configured automatic reconnect must recover the socket.
        alphaSocket.io.engine?.close();
        await disconnected;
        await reconnected;
        alphaSocket.emit('presence', {
            sector: 40,
            displayName: alpha.name,
            character: { name: alpha.name, level: 1, village: 'Ember' },
            tile: 61,
        });

        await expect.poll(() => sectorNames(alphaSocket)).toEqual(expect.arrayContaining([alpha.name, bravo.name]));
        await expect.poll(() => sectorNames(bravoSocket)).toEqual(expect.arrayContaining([alpha.name, bravo.name]));
        expect(connectErrors).toEqual([]);
    } finally {
        alphaSocket.removeAllListeners();
        bravoSocket.removeAllListeners();
        alphaSocket.disconnect();
        bravoSocket.disconnect();
    }
});

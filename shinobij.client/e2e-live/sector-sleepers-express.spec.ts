import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import liveConfig from '../playwright.live.config';

async function account(request: APIRequestContext, prefix: string) {
    const name = uniquePlayerName(stamp => `${prefix}${stamp}`);
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: randomBytes(24).toString('base64url') },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const headers = { 'x-player-name': name, 'x-player-token': String((await registered.json()).token) };
    const save = uiAuditSave();
    save.currentSector = 22;
    save.worldGeoV = 2;
    save.character = { ...save.character, name, pvpShieldUntil: 0 };
    const server = liveConfig.webServer as { env: Record<string, string> };
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': server.env.ADMIN_PASSWORD }, data: save,
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    return { name, headers, character: save.character };
}

test('real AFK sweep exposes a camp without the directory, and an authenticated KO removes it', async ({ request }) => {
    test.setTimeout(180_000);
    const target = await account(request, 'nap');
    const attacker = await account(request, 'watch');
    const beat = async (player: Awaited<ReturnType<typeof account>>) => {
        const response = await request.post('/api/player/heartbeat', {
            headers: player.headers, data: { name: player.name, sector: 22, character: player.character },
        });
        expect(response.status(), await response.text()).toBe(200);
    };
    const sleepers = async (path = '/api/player/roster?sector=22') => {
        const response = await request.get(path);
        expect(response.status(), await response.text()).toBe(200);
        expect(response.headers()['cache-control']).toBe('no-store');
        const body = await response.json() as { sector: number; sleepers: { name: string }[] };
        expect(body.sector).toBe(22);
        return body.sleepers.map(player => player.name);
    };
    await beat(target);
    expect(await sleepers('/player/roster?sector=22')).not.toContain(target.name);
    const refused = await request.post('/api/player/sleeper-kill', {
        headers: attacker.headers, data: { targetName: target.name },
    });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toMatch(/Target is online/);
    // No full-directory request or synthetic camp insertion: the production
    // 90-second offline threshold and 1-second sweep must create this camp.
    await expect.poll(() => sleepers(), { timeout: 115_000, intervals: [2_000] }).toContain(target.name);
    await beat(attacker);
    const killed = await request.post('/api/player/sleeper-kill', {
        headers: attacker.headers, data: { targetName: target.name },
    });
    expect(killed.status(), await killed.text()).toBe(200);
    expect((await killed.json()).ok).toBe(true);
    expect(await sleepers()).not.toContain(target.name);
    const saved = await request.get(`/api/save/${target.name}`, { headers: target.headers });
    expect(saved.status(), await saved.text()).toBe(200);
    expect(await saved.json()).toMatchObject({ currentSector: 0, character: { hospitalized: true, hp: 0 } });
    const repeated = await request.post('/api/player/sleeper-kill', {
        headers: attacker.headers, data: { targetName: target.name },
    });
    expect(repeated.status()).toBe(409);
});

import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { uiAuditSave } from '../../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './player-names';
import { quietRoadCooldowns } from './quiet-road';
import { LATEST_PATCH_NOTE } from '../../src/data/patch-notes';
import type { WorldPosition } from '../../../shared/world-position';

export async function seedWorldActor(request: APIRequestContext, context: BrowserContext, position: WorldPosition, location: { sector: number; tile?: number }, overrides: ReturnType<typeof uiAuditSave> = {}) {
    const name = uniquePlayerName(stamp => `nearby${stamp}`);
    const registration = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'ContinuousJourney!1234' } });
    expect(registration.status(), await registration.text()).toBe(200);
    const token = String((await registration.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = { ...uiAuditSave(), ...overrides, currentSector: location.sector, currentTile: location.tile, worldPosition: position, worldGeoV: 2 };
    save.character = { ...uiAuditSave().character, ...overrides.character, name, village: 'Ashen Leaf Village', storyVillage: 'Ashen Leaf Village', equippedJutsuIds: [], jutsuMastery: [],
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    save.triggeredEvents = (save.triggeredEvents as string[]).map(event => event.replace('stormveil-village', 'ashen-leaf-village'));
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save });
    expect(seeded.status(), await seeded.text()).toBe(200);
    await request.post(`/api/save/${name}?ack=1`, { headers });
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45])); localStorage.setItem('liteFx.v1', '0');
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE?.version ?? '' });
    return { name, headers, sector: location.sector };
}
export async function openWorld(page: Page) {
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    const shell = page.locator('.app-shell[data-screen="worldMap"]'), enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
    await expect(shell.or(enter)).toBeVisible({ timeout: 60_000 }); if (await enter.isVisible()) await enter.click();
    const back = page.getByRole('button', { name: /Return to Sector \d+\b/ });
    await expect.poll(async () => await back.isVisible() || await page.locator('.continuous-world-map').isVisible()).toBe(true);
    if (await back.isVisible()) await back.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
}

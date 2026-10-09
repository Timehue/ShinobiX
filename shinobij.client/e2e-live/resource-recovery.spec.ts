import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import liveQaConfig from '../playwright.live.config';
import { test } from './helpers/reconnecting-request';
import { uniquePlayerName } from './helpers/player-names';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { resourceNode } from '../../shared/resource-nodes';
import { readResourceGathering } from '../../shared/resource-gathering';
import { FRACTURE_TEMPLATES } from '../../shared/fracture-chain';
import { expectVisibleTouchTarget } from '../e2e/helpers/visible-target';

const qaServer = liveQaConfig.webServer;
if (!qaServer || Array.isArray(qaServer) || !qaServer.env?.ADMIN_PASSWORD) throw new Error('Local QA admin configuration is required.');
const qaAdminPassword = qaServer.env.ADMIN_PASSWORD;

test.setTimeout(120_000);
for (const activity of ['mining', 'fishing'] as const) {
    test(`${activity} survives a real world reconnect and settles once`, async ({ page, context, request }, info) => {
        const node = resourceNode(activity === 'mining' ? 'resource-13' : 'resource-1')!;
        const name = uniquePlayerName(stamp => `resume${stamp}`);
        const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'Recovery!' + randomUUID() } });
        expect(registered.status(), await registered.text()).toBe(200);
        const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
        const save = uiAuditSave();
        save.currentSector = node.sector; save.currentTile = node.approach; save.worldGeoV = 2; save.currentBiome = 'central';
        save.character = { ...save.character, name, ryo: 1000, equipment: { pickaxe: 'tool-basic-pickaxe', fishingPole: 'tool-basic-fishing-pole' },
            inventory: [], itemStacks: [], gatheringToolUses: { 'tool-basic-pickaxe': 0, 'tool-basic-fishing-pole': 0 },
            equippedJutsuIds: [], jutsuMastery: [], resourceGathering: { ...readResourceGathering(null), fishingXp: 3200, miningXp: 3200 },
            wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
        expect((await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': qaAdminPassword }, data: save })).status()).toBe(200);
        expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
        const readSave = async () => (await (await request.get(`/api/save/${name}`, { headers })).json()).character;
        const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
        await context.addInitScript(({ name, token, canonical, patch }) => {
            if (localStorage.getItem('resource-recovery-installed') === name) return;
            localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
            localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
            localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
            localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
            localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
            localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
            localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45]));
            localStorage.setItem('resource-recovery-installed', name);
        }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
        await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
        const enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
        const back = page.getByRole('button', { name: /Return to Sector \d+\b/ });
        await expect(page.locator('.continuous-world-map').or(enter).or(back)).toBeVisible({ timeout: 60_000 });
        if (await enter.isVisible()) await enter.click();
        await expect.poll(async () => await back.isVisible() || await page.locator('.continuous-world-map').isVisible()).toBe(true);
        if (await back.isVisible()) await back.click();
        await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
        // Real authorized travel establishes a nonzero authority epoch before
        // admission. Subsequent heartbeat/reload must retain that server value.
        for (const destinationSector of [0, node.sector]) {
            const traveled = await request.post('/api/player/travel', { headers, data: { destinationSector } });
            expect(traveled.status(), await traveled.text()).toBe(200);
            await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).sector, { timeout: 15_000 }).toBe(destinationSector);
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
        await page.getByRole('button', { name: new RegExp(`^${node.name}, ${activity}`) }).click();
        const approach = page.getByRole('button', { name: activity === 'mining' ? 'Approach rock base' : 'Approach shore', exact: true });
        if (await approach.isVisible()) {
            await approach.click();
            await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).tile, { timeout: 30_000 }).toBe(node.approach);
            await page.getByRole('button', { name: new RegExp(`^${node.name}, ${activity}`) }).click();
        }
        if (activity === 'fishing') await page.getByRole('radio', { name: /Watch animation/ }).check();
        await page.getByRole('button', { name: activity === 'mining' ? 'Begin mining · 1 action' : 'Cast line · 1 action' }).click();
        const admitted = await readSave(), attempt = readResourceGathering(admitted.resourceGathering).active!;
        const before = await (await request.get('/api/player/world-move', { headers })).json();
        if (activity === 'mining') {
            const first = FRACTURE_TEMPLATES[attempt.template].sites[0];
            await page.getByRole('button', { name: new RegExp(`^${first.label}, reaches`) }).click();
        }
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
        await expect(page.getByRole('button', { name: 'Abandon attempt (action stays spent)', exact: true })).toBeVisible();
        const after = await (await request.get('/api/player/world-move', { headers })).json();
        await info.attach('reconnect-authority', { body: JSON.stringify({ admitted: attempt, before, after }), contentType: 'application/json' });
        await page.screenshot({ path: info.outputPath(`${activity}-restored.png`), fullPage: true });
        expect(after.sequence).toBe(before.sequence);
        if (activity === 'mining') {
            const formation = FRACTURE_TEMPLATES[attempt.template];
            // Recovery retains the selected seals rather than starting a second attempt.
            const first = page.getByRole('button', { name: new RegExp(`^${formation.sites[0].label}, reaches`) });
            await expect(first).toHaveAttribute('aria-pressed', 'true');
            for (const site of formation.sites.slice(1, formation.charges)) await page.getByRole('button', { name: new RegExp(`^${site.label}, reaches`) }).click();
            const detonate = page.getByRole('button', { name: 'Detonate chain', exact: true });
            if (info.project.name.includes('landscape')) await expectVisibleTouchTarget(detonate);
            await detonate.click();
        } else {
            const collect = page.getByRole('button', { name: 'Collect result', exact: true });
            await expect(collect).toBeEnabled();
            if (info.project.name.includes('landscape')) await expectVisibleTouchTarget(collect);
            await collect.click();
        }
        const result = page.getByRole('region', { name: `${activity === 'mining' ? 'Mining' : 'Fishing'} result` });
        await expect(result).toBeVisible();
        const finished = await readSave(), state = readResourceGathering(finished.resourceGathering);
        const receipt = state.receipts.find(receipt => receipt.id === attempt.id)!;
        expect(receipt.outcome).toMatch(/^(success|failed)$/); expect(receipt.xp).toBe(receipt.outcome === 'success' ? 10 : 3);
        expect(state.active).toBeUndefined(); expect(state.attemptsToday).toBe(1); expect(state.nodes[node.id].attempts).toBe(1);
        expect(finished.gatheringToolUses[activity === 'mining' ? 'tool-basic-pickaxe' : 'tool-basic-fishing-pole']).toBe(1);
        expect(state[`${activity}Xp`]).toBe(3200 + receipt.xp); expect(finished.ryo).toBe(admitted.ryo);
        const replay = await request.post('/api/world/resource', { headers, data: { action: 'resolve', playerName: name, requestId: attempt.id } });
        expect(replay.status(), await replay.text()).toBe(200); expect((await replay.json()).receipt).toEqual(receipt);
        expect(await readSave()).toEqual(finished);
        await page.screenshot({ path: info.outputPath(`${activity}-recovered-result.png`), fullPage: true });
        await page.getByRole('button', { name: 'Back to map', exact: true }).click();
        await page.getByRole('button', { name: new RegExp(`^${node.name}, ${activity}`) }).click();
        await expect(page.locator('.resource-node-stats')).toContainText('2/3');
        await page.getByRole('button', { name: 'Close', exact: true }).click();
    });
}

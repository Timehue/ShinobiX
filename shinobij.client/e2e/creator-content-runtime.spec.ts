import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { openLandingLogin } from './helpers/landing-navigation';
import type { StoryContentPayload } from '../src/lib/story-content-contract';
import { awakeningLv2VnEvent } from '../src/data/vn-events';
import { splitDialogueLine } from '../src/lib/vn';

// Creator content as it is actually stored: verbatim rows from the live admin2
// slot (see the fixture's _source). Every built-in row there is a pre-rebuild
// draft; players must still get the current repository scene.
const live = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'fixtures/creator-live-rows-2026-09-18.json'), 'utf8')) as {
    creatorEvents: Record<string, unknown>[]; petEncounterVn: unknown; ancientChestVn: unknown;
};
const root = path.resolve(import.meta.dirname, '../src/generated/story-content');
const frost = JSON.parse(readFileSync(path.join(root, readdirSync(root).find(f => f.startsWith('frostfang-') && f.endsWith('.json'))!), 'utf8')) as StoryContentPayload;
const STALE_LIVE_TEXT = /Frost Echo|The ice remembers footsteps|Thousand Gates|level 2 and level 20|Admin Event|Test your strength/;

async function preferences(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    });
}
async function serveCreatorSlots(page: Page, creatorEvents: unknown[]) {
    let reads = 0;
    await page.route(/\/api\/save\/admin(?:%20| )?[12](?:\?|$)/i, route => {
        reads++;
        return route.fulfill({ json: { creatorEvents, petEncounterVn: live.petEncounterVn, ancientChestVn: live.ancientChestVn } });
    });
    return () => reads;
}
async function next(page: Page) {
    const reader = page.locator('.cvn-root');
    const old = await reader.innerText();
    await reader.locator('.vn-controls').getByRole('button', { name: /^(Next|Continue)$/ }).click();
    await expect.poll(() => reader.innerText()).not.toBe(old);
}
async function leaveVillage(page: Page) {
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'village');
    await page.getByRole('button', { name: 'Travel', exact: true }).filter({ visible: true }).first().click();
}

test('the live stored Frostfang chapter copy never replaces the current chapter', async ({ page }, info) => {
    const chapter = frost.chapters[0], save = uiAuditSave();
    save.character = { ...save.character, village: frost.village, storyVillage: frost.village, level: 4, storyProgress: 0, storyTraits: [], storyChoices: [] };
    save.triggeredEvents = [...(save.triggeredEvents as string[]), ...frost.interludes.map(i => i.id)];
    await installUiAuditRuntime(page, save);
    await preferences(page);
    const reads = await serveCreatorSlots(page, live.creatorEvents);
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const reader = page.locator('.cvn-root');
    await expect(reader).toBeVisible();
    await expect.poll(reads).toBeGreaterThan(0);
    const firstLine = splitDialogueLine(chapter.pages![0].dialogue[0], chapter.pages![0].speaker).text.replaceAll('%name', 'AuditNinja');
    await expect(reader).toContainText(firstLine);
    for (let i = 0; i < 20 && !await reader.getByText('Elder Sova', { exact: true }).count(); i++)
        await next(page);
    await expect(reader).toContainText('Elder Sova');
    await expect(reader).not.toContainText(STALE_LIVE_TEXT);
    await page.screenshot({ path: info.outputPath('live-stale-frostfang.png') });
});

test('the live stored Awakening copy never replaces the current Awakening scene', async ({ page }, info) => {
    const save = uiAuditSave();
    save.triggeredEvents = (save.triggeredEvents as string[]).filter(id => id !== 'builtin-awakening-lv2');
    await installUiAuditRuntime(page, save);
    await preferences(page);
    const reads = await serveCreatorSlots(page, live.creatorEvents);
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await expect.poll(reads).toBeGreaterThan(0);
    await leaveVillage(page);
    const reader = page.locator('.cvn-root');
    await expect(reader).toBeVisible();
    const lines = awakeningLv2VnEvent.vnPages![0].dialogue.map(line => splitDialogueLine(line, 'Narrator'));
    await expect(reader).toContainText(lines[0].text);
    await next(page);
    await expect(reader).toContainText(lines[1].text);
    await expect(reader).toContainText('Village Elder');
    await expect(reader).not.toContainText(STALE_LIVE_TEXT);
    await page.screenshot({ path: info.outputPath('live-stale-awakening.png') });
});

test('a custom Creator VN plays with its speakers, variables and branches while admin-only rows stay hidden', async ({ page }, info) => {
    const custom = {
        id: 'event-e2e-lantern-night', name: 'Lantern Night', biome: 'forest', icon: 'L', eventKind: 'visualNovel', trigger: 'firstLeaveVillage',
        levelReq: 1, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: [], vnTitle: 'Lantern Night', vnScene: 'Lanterns are going up along the gate.', vnSpeaker: 'Toma Reed',
        vnPages: [
            { title: 'Lanterns at the Gate', scene: 'Dusk at the village gate', speaker: 'Toma Reed', leftName: 'Player', rightName: 'Toma Reed',
                dialogue: ['Narrator: Paper lanterns hang in a line along the gate.', "Toma Reed: %name, hold the ladder steady. I'll hang the last one."],
                choices: [{ text: 'Hold the ladder.', nextPage: 1 }, { text: 'Climb up yourself.', nextPage: 2 }] },
            { title: 'Steady Hands', scene: 'Toma ties off the last lantern', speaker: 'Toma Reed', leftName: 'Player', rightName: 'Toma Reed',
                dialogue: ["Toma Reed: Thanks. That one's for my brother."], choices: [{ text: 'Head out.', nextPage: 1 }] },
            { title: 'Up the Ladder', scene: 'You reach the top rung', speaker: 'Toma Reed', leftName: 'Player', rightName: 'Toma Reed',
                dialogue: ["Toma Reed: Careful with that one. Aren painted it."] },
        ],
    };
    const adminOnly = live.creatorEvents.find(event => event.id === 'event-6ee8ea23-9dc5-40fd-a420-a6f17f6c0266')!;
    await installUiAuditRuntime(page, uiAuditSave());
    await preferences(page);
    const reads = await serveCreatorSlots(page, [...live.creatorEvents, custom]);
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await expect.poll(reads).toBeGreaterThan(0);
    await leaveVillage(page);
    const reader = page.locator('.cvn-root');
    await expect(reader).toBeVisible();
    await expect(reader).toContainText('Paper lanterns hang in a line along the gate.');
    await expect(reader).toContainText('Narrator');
    await next(page);
    await expect(reader).toContainText("AuditNinja, hold the ladder steady. I'll hang the last one.");
    await expect(reader).toContainText('Toma Reed');
    await expect(reader).not.toContainText('%name');
    await reader.getByRole('button', { name: 'Climb up yourself.', exact: true }).click();
    await expect(reader).toContainText('Careful with that one. Aren painted it.');
    await expect(reader).not.toContainText("That one's for my brother.");
    await expect(reader).not.toContainText(STALE_LIVE_TEXT);
    await page.screenshot({ path: info.outputPath('custom-creator-vn.png') });
    // The admin-only reward row (500,000 ryo placeholder) is filtered before it
    // reaches a player: no marker, logbook entry or alert text anywhere.
    await page.goto('/#/logbook', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'logbook');
    await expect.poll(reads).toBeGreaterThan(1);
    await expect(page.locator('.app-shell')).toContainText('Events: 0');
    await expect(page.locator('body')).not.toContainText(String((adminOnly.dialogue as string[])[1]));
});

test('the Admin Panel shows built-in scenes as players get them, not the stored drafts', async ({ page }, info) => {
    test.skip(!['chromium-desktop', 'chromium-mobile'].includes(info.project.name), 'desktop and mobile cover this admin workflow');
    await installUiAuditRuntime(page);
    await page.addInitScript(() => {
        for (const key of ['ninjav-admin-build-v1', 'ninjav-player-accounts-v1', 'shinobix:activePlayerPersist', 'shinobix:activeTokenPersist']) localStorage.removeItem(key);
    });
    const slot = { ...uiAuditSave(), character: { ...uiAuditSave().character, name: 'Admin 2', level: 1 }, creatorEvents: live.creatorEvents, petEncounterVn: live.petEncounterVn, ancientChestVn: live.ancientChestVn };
    await page.route('**/api/admin-auth', route => route.fulfill({ json: { success: true, account: 'Admin 2', role: 'content', token: null } }));
    await page.route(/\/api\/save\/admin[^/]*$/i, route => route.fulfill({ json: route.request().method() === 'GET' ? { ...slot, _saveVersion: 1 } : { ok: true, _saveVersion: 2 } }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openLandingLogin(page);
    await page.getByRole('button', { name: 'Use a name and password' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Admin 2');
    await page.getByPlaceholder('Enter your password').fill('qa-creator-password');
    await page.getByRole('button', { name: /Enter Village/ }).click();
    await page.getByLabel('Password', { exact: true }).fill('qa-creator-password');
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    const issueSeal = page.getByRole('dialog', { name: 'A Timed Issue Seal visual novel scene', exact: true });
    await issueSeal.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.locator('.admin-panel-switcher').getByRole('button', { name: /Visual Novels/ }).click();
    const pet = page.locator('section').filter({ has: page.getByRole('heading', { name: /Pet Encounter VN \(System\)/ }) }).last();
    await expect(pet).toContainText('Tracks Beside Your Own');
    await expect(pet).not.toContainText('A Presence in the Shadows');
    await expect(pet).toContainText('text edits saved here do not change what players read');
    const chest = page.locator('section').filter({ has: page.getByRole('heading', { name: /Ancient Chest VN \(System\)/ }) }).last();
    await expect(chest).toContainText('A Seal Under the Rubble');
    await expect(chest).not.toContainText('Something Stirs in the Ruins');
    const list = page.locator('select').filter({ has: page.locator('option[value="story-frostfang-village-4-0"]') });
    await list.selectOption('story-frostfang-village-4-0');
    const summary = page.locator('.summary-box').filter({ hasText: 'Built-in scene. Players read its text' }).last();
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(`Frostfang Village: ${frost.chapters[0].title}`);
    await expect(page.locator('body')).not.toContainText(/The ice remembers footsteps|Frost Echo|Snow lashes across a frozen training yard/);
    await expect(page.locator('option[value="event-6ee8ea23-9dc5-40fd-a420-a6f17f6c0266"]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('admin-panel-builtins.png'), fullPage: false });
});

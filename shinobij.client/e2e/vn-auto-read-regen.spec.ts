import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import type { StoryContentPayload } from '../src/lib/story-content-contract';

// Idle regen replaces `character` every second while any vital is below max, and
// the reader passes a fresh onAdvance on each of those renders. Auto-read waits
// at least 2.6 s, so a timer tied to that callback's identity never fired.
const READING_DELAY_MAX_MS = 6_800;

const contentRoot = path.resolve(import.meta.dirname, '../src/generated/story-content');
const content = JSON.parse(readFileSync(
    path.join(contentRoot, readdirSync(contentRoot).find(file => file.startsWith('ashen-leaf-') && file.endsWith('.json'))!),
    'utf8',
)) as StoryContentPayload;

const OVERFLOW_LINE = 'Every part of this report must remain readable before the scene advances. '.repeat(16);

async function openSceneWithAutoRead(page: Page, vitals: 'full' | 'regenerating', overflow = false, autoRead = true) {
    const scene = content.interludes.find(candidate => candidate.levelReq === 30)!;
    const save = uiAuditSave();
    const { maxHp, maxChakra, maxStamina } = save.character;
    const short = vitals === 'regenerating' ? 0.5 : 1;
    save.character = {
        ...save.character, village: content.village, storyVillage: content.village, level: 30, storyProgress: 3,
        storyTraits: [], storyChoices: [], pendingStoryReports: [], storyEpilogues: [],
        hp: Math.floor(maxHp * short), chakra: Math.floor(maxChakra * short), stamina: Math.floor(maxStamina * short),
    };
    save.triggeredEvents = (save.triggeredEvents as string[]).concat(content.interludes.map(entry => entry.id))
        .filter(id => id !== scene.id);
    await installUiAuditRuntime(page, save);
    if (overflow) {
        const payload = structuredClone(content);
        payload.interludes.find(entry => entry.id === scene.id)!.pages[0].dialogue = [OVERFLOW_LINE, 'The next line starts at the top.'];
        await page.route('**/assets/ashen-leaf-*.json', route => route.fulfill({ json: payload }));
    }
    await page.addInitScript((automatic) => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', automatic ? '1' : '0');
        localStorage.setItem('pet-music-muted', '1');
    }, autoRead);
    const reader = page.locator('.cvn-root');
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await expect(reader).toBeVisible();
    if (autoRead) await expect(reader.locator('.cvn-auto-status')).toBeVisible();
    return reader;
}

for (const vitals of ['regenerating', 'full'] as const) {
    test(`auto-read advances a story line by itself with ${vitals} vitals`, async ({ page }, info) => {
        test.skip(info.project.name !== 'chromium-mobile', 'timer behaviour, not layout; one browser proves it');
        const reader = await openSceneWithAutoRead(page, vitals);
        const opening = await reader.innerText();
        await expect.poll(() => reader.innerText(), { timeout: READING_DELAY_MAX_MS + 3_000 }).not.toBe(opening);
    });
}

const scrollState = async (reader: import('@playwright/test').Locator) => reader.locator('.cvn-dialogue-shell').evaluate(shell => {
    const text = shell.querySelector<HTMLElement>('.cvn-dialogue-text')!;
    const scroller = text.scrollHeight > text.clientHeight + 1 ? text : shell;
    return { top: scroller.scrollTop, height: scroller.clientHeight, maximum: scroller.scrollHeight - scroller.clientHeight };
});

test('auto-read reveals overflowing text and waits before advancing to a reset line', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-mobile', 'timer and overflow recovery contract');
    const reader = await openSceneWithAutoRead(page, 'full', true);
    const text = reader.locator('.cvn-dialogue-text');
    await expect(text).toHaveText(OVERFLOW_LINE.trim());
    const before = await scrollState(reader);
    expect(before.maximum).toBeGreaterThan(before.height);
    await expect.poll(async () => (await scrollState(reader)).top, { timeout: READING_DELAY_MAX_MS + 3_000 }).toBeGreaterThan(0);
    await expect(text).toHaveText(OVERFLOW_LINE.trim());
    const revealed = await scrollState(reader);
    expect(revealed.top).toBeLessThanOrEqual(revealed.height);
    // The reader may manually finish scrolling while Auto-read is enabled.
    await reader.locator('.cvn-dialogue-shell').evaluate(shell => {
        const text = shell.querySelector<HTMLElement>('.cvn-dialogue-text')!;
        text.scrollTop = text.scrollHeight;
        shell.scrollTop = shell.scrollHeight;
    });
    await expect(text).toHaveText('The next line starts at the top.', { timeout: READING_DELAY_MAX_MS + 3_000 });
    expect((await scrollState(reader)).top).toBe(0);
});

test('manual advance reveals one viewport at a time instead of skipping the middle', async ({ page }, info) => {
    test.skip(info.project.name !== 'chromium-mobile', 'manual overflow recovery contract');
    const reader = await openSceneWithAutoRead(page, 'full', true, false);
    const text = reader.locator('.cvn-dialogue-text');
    await expect(text).toHaveText(OVERFLOW_LINE.trim());
    const before = await scrollState(reader);
    expect(before.maximum).toBeGreaterThan(before.height);
    await reader.focus();
    await page.keyboard.press('ArrowRight');
    const after = await scrollState(reader);
    expect(after.top).toBeGreaterThan(0);
    expect(after.top).toBeLessThanOrEqual(before.height);
    await expect(text).toHaveText(OVERFLOW_LINE.trim());
    for (let step = 0; step < 12 && (await text.textContent())?.trim() === OVERFLOW_LINE.trim(); step++) {
        await page.keyboard.press('ArrowRight');
    }
    await expect(text).toHaveText('The next line starts at the top.');
    expect((await scrollState(reader)).top).toBe(0);
});


test('fixed dialogue bounds survive the actual choice and its result', async ({ page }, info) => {
    test.skip(!['chromium-desktop', 'chromium-mobile', 'webkit-mobile'].includes(info.project.name), 'desktop and touch choice/result geometry');
    const reader = await openSceneWithAutoRead(page, 'full', false, false);
    const box = reader.locator('.cvn-dialogue-shell');
    const bounds = async () => {
        const rect = (await box.boundingBox())!;
        return [rect.x, rect.y, rect.width, rect.height].map(Math.round);
    };
    const initial = await bounds();
    const choice = reader.locator('.vn-choice-btn').first();
    for (let step = 0; step < 30 && !await choice.isVisible(); step++) {
        await reader.getByRole('button', { name: 'Next', exact: true }).click();
        expect(await bounds()).toEqual(initial);
    }
    await expect(choice).toBeVisible();
    await expect(choice).toBeEnabled();
    expect(await bounds()).toEqual(initial);
    await choice.click();
    await expect(reader.locator('.vn-conclusion')).toBeVisible();
    expect(await bounds()).toEqual(initial);
    await expect(reader.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});

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

async function openSceneWithAutoRead(page: Page, vitals: 'full' | 'regenerating') {
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
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '1');
        localStorage.setItem('pet-music-muted', '1');
    });
    const reader = page.locator('.cvn-root');
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await expect(reader).toBeVisible();
    await expect(reader.locator('.cvn-auto-status')).toBeVisible();
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

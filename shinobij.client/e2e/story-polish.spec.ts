import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('revised irrigation ending reaches the reader with its limits and Toma as speaker', async ({ page }, info) => {
    const root = path.resolve(import.meta.dirname, '../src/generated/story-content');
    const file = readdirSync(root).find(f => f.startsWith('epilogues-ashen-leaf-') && f.endsWith('.json'))!;
    const endings = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    const ending = endings.find((e: { lane: string; requireAnyTrait?: string[] }) => e.lane === 'honorable' && e.requireAnyTrait);
    const expected = ending.pages[1].dialogue[1];
    expect(expected).toContain("the water-screw won't warm them");
    const save = uiAuditSave();
    save.character = { ...save.character, village: 'Ashen Leaf Village', storyVillage: 'Ashen Leaf Village', storyProgress: 9,
        storyEpilogues: [{ version: 1, chapterEventId: 'story-ashen-leaf-village-100-8', lane: 'honorable', status: 'pending', presentationTraits: ['al100-proof-presented-carried'] }] };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const reader = page.locator('.cvn-root');
    await expect(reader).toBeVisible();
    for (let i = 0; i < 12 && !(await reader.getByText(expected, { exact: true }).count()); i++) {
        const old = await reader.innerText();
        await reader.locator('.vn-controls').getByRole('button', { name: 'Next', exact: true }).click();
        await expect.poll(() => reader.innerText()).not.toBe(old);
    }
    await expect(reader.getByText(expected, { exact: true })).toBeVisible();
    await expect(reader).toContainText('Toma Reed');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('revised-irrigation-ending.png') });
});

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import type { StoryContentPayload } from '../src/lib/story-content-contract';
import type { Character } from '../src/types/character';
const root = path.resolve(import.meta.dirname, '../src/generated/story-content');
const frost = JSON.parse(readFileSync(path.join(root, readdirSync(root).find(f => f.startsWith('frostfang-') && f.endsWith('.json'))!), 'utf8')) as StoryContentPayload;
async function preferences(page: Page) {
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    });
}
async function next(page: Page) {
    const reader = page.locator('.cvn-root');
    const old = await reader.innerText();
    await reader.locator('.vn-controls').getByRole('button', { name: /^(Next|Continue)$/ }).click();
    await expect.poll(() => reader.innerText()).not.toBe(old);
}
test('Frostfang loads current generated dialogue and choices over stale shared admin text', async ({ page }, info) => {
    const chapter = frost.chapters[0], save = uiAuditSave();
    save.character = { ...save.character, village: frost.village, storyVillage: frost.village, level: 4, storyProgress: 0, storyTraits: [], storyChoices: [] };
    save.triggeredEvents = [...(save.triggeredEvents as string[]), ...frost.interludes.map(i => i.id)];
    const stale = { id: 'story-frostfang-village-4-0', name: 'Obsolete intake', biome: 'snow', icon: 'F', eventKind: 'visualNovel', trigger: 'manual', levelReq: 4, xpReward: 0, ryoReward: 0, staminaReward: 0, dialogue: ['STALE NARRATIVE MUST NOT APPEAR'], vnPages: chapter.pages!.map(p => ({ ...p, speaker: 'Wrong Speaker', dialogue: ['STALE NARRATIVE MUST NOT APPEAR'], lines: [{ speaker: 'Wrong Speaker', text: 'STALE TYPED LINE' }], choices: [{ text: 'Obsolete choice', nextPage: 999 }] })) };
    const savedArt = 'https://story-fixture.invalid/saved-intake.png';
    stale.vnPages[1].image = savedArt;
    await page.route(savedArt, route => route.fulfill({ contentType: 'image/png', body: readFileSync(path.resolve(import.meta.dirname, '../public/icon-512.png')) }));
    const runtime = await installUiAuditRuntime(page, save);
    await preferences(page);
    let sharedReads = 0;
    let sharedFulfilled = 0;
    let releaseShared: () => void = () => {};
    const sharedGate = new Promise<void>(resolve => { releaseShared = resolve; });
    await page.route(/\/api\/save\/admin(?:%20| )?[12](?:\?|$)/i, async route => {
        sharedReads++;
        await sharedGate;
        await route.fulfill({ json: { creatorEvents: [stale] } });
        sharedFulfilled++;
    });
    const fetched: string[] = [];
    page.on('response', r => {
        if (r.url().includes('frostfang-') && r.headers()['content-type']?.includes('application/json'))
            fetched.push(r.url());
    });
    const persistedCharacter = (): Character | undefined => {
        const posted = runtime.lastCommit()?.postedState;
        return posted ? (JSON.parse(posted) as { character: Character }).character : undefined;
    };
    const recorded = () => {
        const character = persistedCharacter();
        if (!character) return undefined;
        return {
            scene: character.storyScene,
            choices: character.storyChoices ?? [],
            traits: character.storyTraits ?? [],
            reports: character.pendingStoryReports ?? [],
            epilogues: character.storyEpilogues ?? [],
            progress: character.storyProgress ?? 0,
            village: character.storyVillage || character.village,
            triggeredEvents: (JSON.parse(runtime.lastCommit()!.postedState) as { triggeredEvents?: string[] }).triggeredEvents ?? [],
        };
    };
    try {
        await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
        const reader = page.locator('.cvn-root');
        await expect(reader).toBeVisible();
        await expect.poll(() => sharedReads).toBe(2);
        await expect(reader).not.toContainText(/STALE|Wrong Speaker|Obsolete/);
        const intake = chapter.pages![1];
        for (let i = 0; i < 20 && !await reader.getByText(intake.dialogue[0], { exact: true }).count(); i++)
            await next(page);
        await expect(reader).toContainText(intake.dialogue[0]);
        await expect(reader).toContainText('Elder Sova');
        await next(page);
        await expect(reader).toContainText(intake.dialogue[1]);
        await expect.poll(() => persistedCharacter()?.storyScene).toMatchObject({
            eventId: stale.id, pageIndex: 1, lineIndex: 1,
        });
        expect(sharedFulfilled).toBe(0);
        const before = recorded();
        expect(before).toBeDefined();
        const beforeText = await reader.innerText();
        const beforeIdentity = await reader.getAttribute('aria-label');
        const readerNode = await reader.elementHandle();
        if (!readerNode || !beforeIdentity) throw new Error('Canonical Intake reader identity is missing');
        releaseShared();
        await expect.poll(() => reader.evaluate(el => getComputedStyle(el).getPropertyValue('--cvn-background'))).toContain(savedArt);
        await expect.poll(() => sharedFulfilled).toBe(2);
        expect(await reader.evaluate((current, original) => current === original, readerNode)).toBe(true);
        await readerNode.dispose();
        await expect(reader).toHaveAttribute('aria-label', beforeIdentity);
        await expect.poll(() => reader.innerText()).toBe(beforeText);
        expect(recorded()).toEqual(before);
        for (let i = 0; i < 20 && !await reader.locator('.vn-choice-btn').count(); i++)
            await next(page);
        const choice = intake.choices![1];
        await reader.getByRole('button', { name: choice.text, exact: true }).click();
        const branchText = chapter.pages![choice.nextPage].dialogue[0].replaceAll('%name', 'AuditNinja');
        await expect(reader).toContainText(branchText);
        await expect(reader).not.toContainText(/STALE|Obsolete/);
        const receipts = () => (persistedCharacter()?.storyChoices ?? [])
            .filter(row => row.eventId === stale.id && row.pageIndex === 1);
        await expect.poll(receipts).toEqual([expect.objectContaining({
            version: 1, eventId: stale.id, pageId: intake.id || 'v1:p1',
            choiceId: choice.id || 'v1:c1', pageIndex: 1, choiceIndex: 1,
            nextPage: choice.nextPage, trait: choice.trait,
        })]);
        await expect.poll(() => persistedCharacter()?.storyScene).toMatchObject({
            eventId: stale.id, pageIndex: choice.nextPage, lineIndex: 0,
        });
        const branchRecord = recorded();
        expect(branchRecord?.progress).toBe(before!.progress);
        expect(branchRecord?.village).toBe(before!.village);
        expect(branchRecord?.triggeredEvents).toEqual(before!.triggeredEvents);
        expect(branchRecord?.epilogues).toEqual(before!.epilogues);
        // This chapter is archived only after its sealed boss win, never on open/art/choice.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(reader).toBeVisible();
        await expect(reader).toContainText(branchText);
        await expect(reader).not.toContainText(/STALE|Wrong Speaker|Obsolete/);
        expect(receipts()).toHaveLength(1);
        expect(recorded()).toEqual(branchRecord);
        expect(fetched.length).toBeGreaterThan(0);
        await page.screenshot({ path: info.outputPath('canonical-frostfang.png') });
    } finally {
        releaseShared();
    }
});

test('Senna first-clear receipt reaches the reader with clear testimony and the right speaker', async ({ page }, info) => {
    const save = uiAuditSave();
    save.character = { ...save.character, riftFirstClears: { 'rift-legacy-echo': { at: 1 } }, storyEpilogues: [] };
    await installUiAuditRuntime(page, save);
    await preferences(page);
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const reader = page.locator('.cvn-root');
    await expect(reader).toBeVisible();
    await expect(reader).toContainText('Senna Graveward');
    await expect(reader).toContainText("You kept it clear. I can make out the hand, the gate, and the witness mark.");
    await next(page);
    await expect(reader).toContainText("We still don't have their name. But now we have a copy of what they did, even if the stone wears away.");
    await expect(reader).not.toContainText('Open hand. Closed gate.');
    await page.screenshot({ path: info.outputPath('senna-first-clear.png') });
});

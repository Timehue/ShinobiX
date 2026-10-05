import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ERA_CHAPTERS, eraChapterProgress } from '../../shared/era-chapters';
import type { EraJourney } from '../../shared/era-chapters';
import { PUBLIC_CAPABILITY_IDS } from '../../shared/public-capabilities';

test('Hall refreshes admission immediately after sealing the preceding campaign', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const chapter = ERA_CHAPTERS[0];
    const stages = chapter.routes[0]!.stages!;
    let journey: EraJourney = { version: 2, routeId: 'field', startedAt: 1000, baselines: {}, stageIndex: stages.length,
        stageStartedAt: 2000, stageCounts: {}, completedStages: stages.map(stage => ({ id: stage.id, at: 2000 })), proofReceipts: [] };
    let reads = 0;
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data: unknown;
        if (url.pathname === '/api/player/capabilities') data = { ok: true, capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }])) };
        else if (url.pathname === '/api/eras') data = { eras: [ERA_CHAPTERS[0], ERA_CHAPTERS[1], ERA_CHAPTERS[3]].map(era => ({ id: era.eraId, number: ERA_CHAPTERS.indexOf(era) + 1, name: era.name, description: '', lore: '', banner: '/badges/level-10.webp', status: 'unlocked', milestones: [], trigger: null, unlockedAt: 1000 })) };
        else if (url.pathname === '/api/hall-of-legends') data = { entries: [] };
        else if (url.pathname === '/api/eras/journey' && route.request().method() === 'POST') {
            expect(route.request().postDataJSON().action).toBe('complete');
            journey = { ...journey, completedAt: Date.now() };
            data = { ok: true, chapter: eraChapterProgress(chapter, journey, {}, true), _saveVersion: 2,
                character: { name: 'eraqa', eraJourneys: { [chapter.eraId]: journey }, serverTitles: [chapter.rewardTitle] } };
        } else if (url.pathname === '/api/eras/journey') {
            reads++;
            data = { chapters: ERA_CHAPTERS.map((era, index) => ({ ...eraChapterProgress(era, index === 0 ? journey : undefined, {}, index === 0 || (index === 1 && Boolean(journey.completedAt))),
                ...(index === 1 && !journey.completedAt ? { blockedReason: 'Complete the Era I campaign first.' } : {}),
                ...(index === 3 ? { available: false, ready: false, objectives: [], blockedReason: 'Complete the Era III campaign first.' } : {}) })) };
        } else data = {};
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/e2e/fixtures/world-eras.html?hall=1');
    const first = page.getByRole('region', { name: chapter.name });
    const second = page.getByRole('region', { name: ERA_CHAPTERS[1].name });
    await expect(second).toContainText('Complete the Era I campaign first.', { timeout: 20000 });
    await expect(page.getByText('WORLD UNLOCKED', { exact: true })).toHaveCount(3);
    const unavailable = page.getByRole('region', { name: ERA_CHAPTERS[3].name });
    await expect(unavailable).toContainText('Complete the Era III campaign first.');
    await expect(unavailable).toContainText('YOUR ERA CAMPAIGN');
    await expect(unavailable).not.toContainText('WHEN THIS AGE OPENS');
    await expect(unavailable.getByRole('button')).toHaveCount(0);
    const before = reads;
    await first.getByRole('button', { name: 'Return your account and earn the title' }).click();
    await expect(first).toContainText('Account recorded');
    await expect(second.getByRole('button', { name: 'Take this commission' })).toHaveCount(2, { timeout: 5000 });
    expect(reads).toBeGreaterThan(before);
    expect(errors).toEqual([]);
});

for (const index of [2, 3]) test(`Hall opens Era ${index + 2} immediately after sealing Era ${index + 1}`, async ({ page }) => {
    const chapter = ERA_CHAPTERS[index]!;
    const next = ERA_CHAPTERS[index + 1]!;
    const stages = chapter.routes[0]!.stages!;
    let journey: EraJourney = { version: 2, routeId: chapter.routes[0]!.id, startedAt: 1000, baselines: {},
        stageIndex: stages.length, stageStartedAt: 2000, stageCounts: {},
        completedStages: stages.map(stage => ({ id: stage.id, at: 2000 })), proofReceipts: [] };
    let reads = 0;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        let data: unknown;
        if (url.pathname === '/api/player/capabilities') data = { ok: true, capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, { state: 'available', reason: 'available' }])) };
        else if (url.pathname === '/api/eras') data = { eras: [chapter, next].map(era => ({ id: era.eraId, number: ERA_CHAPTERS.indexOf(era) + 1, name: era.name, description: '', lore: '', banner: '/badges/level-10.webp', status: 'unlocked', milestones: [], trigger: null, unlockedAt: 1000 })) };
        else if (url.pathname === '/api/hall-of-legends') data = { entries: [] };
        else if (url.pathname === '/api/eras/journey' && route.request().method() === 'POST') {
            expect(route.request().postDataJSON()).toMatchObject({ action: 'complete', eraId: chapter.eraId });
            journey = { ...journey, completedAt: Date.now() };
            data = { ok: true, chapter: eraChapterProgress(chapter, journey, {}, true), _saveVersion: 2,
                character: { name: 'eraqa', eraJourneys: { [chapter.eraId]: journey }, serverTitles: [chapter.rewardTitle] } };
        } else if (url.pathname === '/api/eras/journey') {
            reads++;
            data = { chapters: [eraChapterProgress(chapter, journey, {}, true),
                { ...eraChapterProgress(next, undefined, {}, Boolean(journey.completedAt)),
                    ...(!journey.completedAt ? { blockedReason: `Complete the Era ${index === 2 ? 'III' : 'IV'} campaign first.` } : {}) }] };
        } else data = {};
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/e2e/fixtures/world-eras.html?hall=1');
    const currentRegion = page.getByRole('region', { name: chapter.name });
    const nextRegion = page.getByRole('region', { name: next.name });
    await expect(nextRegion).toContainText(`Complete the Era ${index === 2 ? 'III' : 'IV'} campaign first.`, { timeout: 20000 });
    await expect(nextRegion.getByRole('button')).toHaveCount(0);
    const before = reads;
    await currentRegion.getByRole('button', { name: 'Return your account and earn the title' }).click();
    await expect(currentRegion).toContainText('Account recorded');
    await expect(nextRegion.getByRole('button', { name: 'Take this commission' })).toHaveCount(2, { timeout: 5000 });
    expect(reads).toBeGreaterThan(before);
    expect(errors).toEqual([]);
});

for (const index of [3, 4]) test(`Era ${index + 1} shows the complete endgame campaign and seals its second perspective`, async ({ page }, testInfo) => {
    const chapter = ERA_CHAPTERS[index];
    const stages = chapter.routes[0]!.stages!;
    const routeId = chapter.routes[1]!.id;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/eras/journey', async route => {
        const action = route.request().postDataJSON();
        const now = Date.now();
        const journey: EraJourney = { version: 2, routeId, startedAt: 1000, baselines: {}, stageIndex: action.action === 'complete' ? stages.length : 0,
            stageStartedAt: now, stageCounts: {}, completedStages: action.action === 'complete' ? stages.map(stage => ({ id: stage.id, at: now })) : [], proofReceipts: [],
            ...(action.action === 'complete' ? { completedAt: now } : {}) };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, _saveVersion: action.action === 'complete' ? 2 : 1,
            chapter: eraChapterProgress(chapter, journey, {}, true), character: { name: 'eraqa', eraJourneys: { [chapter.eraId]: journey }, serverTitles: action.action === 'complete' ? [chapter.rewardTitle] : [] } }) });
    });
    await page.goto(`/e2e/fixtures/world-eras.html?era=${index}`);
    const personal = page.getByRole('region', { name: chapter.name });
    await expect(personal).toContainText('four live players');
    await expect(personal).toContainText(index === 3 ? 'Stage IV (Proven)' : 'Stage V (summit)');
    await expect(personal).toContainText('Any rarity qualifies');
    await expect(personal.getByLabel('Campaign stages').getByText(/Pass the Endless Spire tier/)).toHaveCount(3);
    await expect(personal.getByRole('button', { name: 'Take this commission' })).toHaveCount(2);
    await personal.getByRole('button', { name: 'Take this commission' }).last().click();
    await expect(personal).toContainText(`0 / ${index === 3 ? 225 : 450}`);
    await expect(personal.getByRole('button', { name: 'Gather the remaining evidence' })).toBeDisabled();
    await personal.getByRole('button', { name: 'Go investigate' }).last().click();
    await expect(page.getByLabel('Destination')).toHaveText('hollowGateShrine');
    for (let stage = 0; stage < stages.length; stage++) {
        if (stage >= 2) {
            await expect(personal.getByRole('button', { name: 'Gather the remaining evidence' })).toBeDisabled();
            await expect(personal).toContainText('All conditions must happen in the same run.');
            await personal.getByRole('button', { name: 'Go investigate' }).click();
            await expect(page.getByLabel('Destination')).toHaveText('battleTowers');
        }
        await page.getByRole('button', { name: 'QA: complete current stage' }).click();
    }
    await personal.getByRole('button', { name: 'Return your account and earn the title' }).click();
    await expect(personal).toContainText('Account recorded');
    await expect(personal).toContainText(chapter.routes[1]!.conclusion);
    await personal.getByRole('button', { name: 'Wear your title' }).click();
    await expect(page.getByLabel('Destination')).toHaveText('profile');
    expect((await new AxeBuilder({ page }).include('.era-chapter').analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`era-${index + 1}-recorded.png`), fullPage: true });
});

test('historical completion preserves its title and offers only the server-accepted perspective', async ({ page }) => {
    await page.goto('/e2e/fixtures/world-eras.html?historical=1');
    const personal = page.getByRole('region', { name: ERA_CHAPTERS[0].name });
    await expect(personal).toContainText('Your earlier chapter title is preserved.');
    await expect(personal).toContainText('Continue with your recorded perspective.');
    await expect(personal.getByRole('button', { name: 'Take this commission' })).toHaveCount(1);
    await page.route('**/api/eras/journey', async route => {
        expect(route.request().postDataJSON().routeId).toBe('duel');
        const journey: EraJourney = { version: 2, routeId: 'duel', startedAt: Date.now(), baselines: {}, stageIndex: 0,
            stageStartedAt: Date.now(), stageCounts: {}, completedStages: [], proofReceipts: [], legacyCompletedAt: 1100 };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, _saveVersion: 2,
            chapter: eraChapterProgress(ERA_CHAPTERS[0], journey, {}, true), character: { name: 'eraqa', eraJourneys: { 'shinobi-awakening': journey }, serverTitles: [ERA_CHAPTERS[0].rewardTitle] } }) });
    });
    await personal.getByRole('button', { name: 'Take this commission' }).click();
    await expect(personal).toContainText('0 / 30');
    await expect(personal).toContainText('Your earlier chapter title is preserved.');
    await expect(personal.getByRole('button', { name: 'Gather the remaining evidence' })).toBeDisabled();
});

test('choose a route, follow objectives, and seal a permanent chapter on desktop and mobile', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const chapter = ERA_CHAPTERS[0];
    const stages = chapter.routes[0]!.stages!;
    let journey: EraJourney = { version: 2, routeId: 'field', startedAt: Date.now(), baselines: {}, stageIndex: 0, stageStartedAt: Date.now(), stageCounts: {}, completedStages: [], proofReceipts: [] };
    await page.route('**/api/eras/journey', async route => {
        const body = route.request().postDataJSON();
        if (body.action === 'complete') journey = { ...journey, stageIndex: stages.length, completedStages: stages.map(stage => ({ id: stage.id, at: Date.now() })), completedAt: Date.now() };
        const progress = eraChapterProgress(chapter, journey, {}, true);
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, _saveVersion: body.action === 'complete' ? 2 : 1, chapter: progress, character: { name: 'eraqa', eraJourneys: { [chapter.eraId]: journey }, serverTitles: body.action === 'complete' ? [chapter.rewardTitle] : [] } }) });
    });
    await page.goto('/e2e/fixtures/world-eras.html', { waitUntil: 'domcontentloaded' });
    const personal = page.getByRole('region', { name: chapter.name });
    await expect(personal.getByRole('button', { name: 'Take this commission' })).toHaveCount(2);
    await expect(personal.getByLabel('Campaign stages').getByRole('listitem').first()).toContainText('30');
    await expect(page.getByRole('region', { name: 'Corrections to the Deep Map' })).toContainText('Complete the Era I campaign first.');
    await expect(page.getByRole('region', { name: 'The First Mythic Survey' })).toContainText('The community must open this age');
    await expect(page.getByRole('region', { name: 'The First Mythic Survey' }).getByRole('button')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('routes.png'), fullPage: true });
    await personal.getByRole('button', { name: 'Take this commission' }).first().click();
    await expect(personal).toContainText('0 / 30');
    await expect(personal.getByRole('button', { name: 'Gather the remaining evidence' })).toBeDisabled();
    await personal.getByRole('button', { name: 'Go investigate' }).click();
    await expect(page.getByLabel('Destination')).toHaveText('missions');
    await page.getByRole('button', { name: 'QA: complete current stage' }).click();
    await expect(personal).toContainText('The assignments others declined');
    await expect(personal.getByRole('button', { name: 'Gather the remaining evidence' })).toBeDisabled();
    await page.getByRole('button', { name: 'QA: complete current stage' }).click();
    await expect(personal).toContainText('0 / 1');
    await expect(personal).toContainText('All conditions must happen in the same run.');
    await personal.getByRole('button', { name: 'Go investigate' }).click();
    await expect(page.getByLabel('Destination')).toHaveText('battleTowers');
    await page.screenshot({ path: testInfo.outputPath('examination.png'), fullPage: true });
    await page.getByRole('button', { name: 'QA: complete current stage' }).click();
    await personal.getByRole('button', { name: 'Return your account and earn the title' }).click();
    await expect(personal).toContainText('Account recorded');
    await expect(personal).toContainText('The names you carried back remain visible beneath your own.');
    await personal.getByRole('button', { name: 'Wear your title' }).click();
    await expect(page.getByLabel('Destination')).toHaveText('profile');
    const accessibility = await new AxeBuilder({ page }).include('.era-chapter').analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('recorded.png'), fullPage: true });
});

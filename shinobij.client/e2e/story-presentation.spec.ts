import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import type { StoryContentPayload } from '../src/lib/story-content-contract';
import type { SoloPveSession } from '../src/lib/solo-pve-api';

test.setTimeout(180_000);

const before = process.env.STORY_PRESENTATION_PHASE === 'before';
const evidenceDirectory = process.env.STORY_PRESENTATION_ARTIFACT_ROOT
    ? path.resolve(process.env.STORY_PRESENTATION_ARTIFACT_ROOT)
    : path.resolve(import.meta.dirname, '../../docs/story-presentation-evidence', before ? 'before' : 'after');
const contentRoot = path.resolve(import.meta.dirname, '../src/generated/story-content');
const villages = ['ashen-leaf', 'stormveil', 'frostfang', 'moonshadow'];
const contents = villages.map(slug => JSON.parse(readFileSync(path.join(contentRoot, readdirSync(contentRoot).find(file => file.startsWith(`${slug}-`) && file.endsWith('.json'))!), 'utf8')) as StoryContentPayload);

async function screenshot(page: Page, info: TestInfo, name: string) {
    const directory = evidenceDirectory;
    mkdirSync(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${name}-${info.project.name}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}
async function readerPrefs(page: Page, mode = 'cinematic') {
    await page.addInitScript(mode => {
        localStorage.setItem('vnReaderMode.v1', mode);
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    }, mode);
}
async function step(page: Page, choose = 0) {
    const finale = page.locator('.vn-finale-panel');
    if (await finale.isVisible()) {
        await finale.getByRole('button', { name: /^Continue(?: to Story Hall)?$/ }).click();
        return;
    }
    const reader = page.locator('.cvn-root, .visual-novel.admin-vn-play, .vn-finale-panel');
    const choice = reader.locator('.vn-choice-btn').nth(choose);
    if (await choice.isVisible()) { await expect(choice).toBeEnabled(); await choice.click(); return; }
    const conclusion = reader.locator('.vn-conclusion');
    if (await conclusion.isVisible()) { await conclusion.getByRole('button', { name: 'Continue', exact: true }).click(); return; }
    const next = reader.locator('.vn-controls').getByRole('button', { name: /^(Next|Continue|Begin Battle|Continue to Story Hall)$/ });
    // Completion can unmount the reader between the loop's count and this
    // step. Await that transition instead of looking for a vanished button.
    await expect.poll(async () => !(await reader.count()) || await next.isVisible()).toBe(true);
    if (!(await reader.count())) return;
    const old = await reader.innerText();
    await next.click();
    await expect.poll(async () => await reader.count() ? reader.innerText() : '').not.toBe(old);
}

for (const [index, content] of contents.entries()) {
    test(`${villages[index]} recorded relationship reaches its authored repair and archived payoff`, async ({ page }, info) => {
        test.skip(before || info.project.name !== 'chromium-mobile', 'focused live callback coverage; exhaustive branch graph checked separately');
        const original = content.interludes.find(scene => scene.levelReq === 30)!;
        const payoff = content.interludes.find(scene => scene.levelReq === 88)!;
        const originalChoice = original.pages.at(-1)!.choices![2];
        const repair = payoff.pages.flatMap(p => p.choices ?? []).find(c => c.trait?.endsWith('repaired-trust'))!;
        const reaction = payoff.pages[repair.nextPage];
        const initial = uiAuditSave();
        initial.character = { ...initial.character, village: content.village, storyVillage: content.village, level: 30, storyProgress: 3, storyTraits: [], storyChoices: [], pendingStoryReports: [], storyEpilogues: [] };
        const uploadedAvatar = 'https://story-fixture.invalid/player-upload.webp';
        if (index === 1) {
            initial.character.avatarImage = uploadedAvatar;
            await page.route(uploadedAvatar, route => route.fulfill({
                contentType: 'image/png', body: readFileSync(path.resolve(import.meta.dirname, '../public/icon-512.png')),
            }));
        }
        initial.triggeredEvents = [...initial.triggeredEvents as string[], ...content.interludes.map(scene => scene.id)]
            .filter(id => ![original.id, payoff.id].includes(id));
        const runtime = await installUiAuditRuntime(page, initial);
        await readerPrefs(page, index % 2 ? 'classic' : 'cinematic');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.route('**/api/story/interlude', route => route.fulfill({ json: { ok: true, trait: route.request().postDataJSON().trait } }));
        const reader = page.locator('.cvn-root, .visual-novel.admin-vn-play, .vn-finale-panel');
        await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
        await expect(reader).toBeVisible();
        for (let i = 0; i < 70 && await reader.count(); i++) {
            const target = reader.getByRole('button', { name: originalChoice.text, exact: true });
            if (await target.count()) {
                await expect(target).toBeEnabled();
                if (index === 1) await expect(reader.getByRole('img', { name: 'Player', exact: true })).toHaveAttribute('src', uploadedAvatar);
                await screenshot(page, info, `${villages[index]}-original-choice`);
                await target.click();
            } else await step(page);
        }
        await expect(reader).toHaveCount(0);
        await expect.poll(() => runtime.lastCommit()?.postedState ?? '').toContain(originalChoice.trait!);
        await expect.poll(() => JSON.parse(runtime.lastCommit()!.postedState).character.pendingStoryReports?.length ?? 0).toBe(0);
        const saved = JSON.parse(runtime.lastCommit()!.postedState).character;
        expect(saved.storyChoices.some((row: { eventId: string; trait: string }) => row.eventId === original.id && row.trait === originalChoice.trait)).toBe(true);
        // Only the intervening milestone and retained level-65 object are seeded.
        // The relationship trait and exact choice are from the mounted reader.
        const proofs = ['al65-saved-the-screw', 'sv65-saved-the-reason', 'ff65-saved-the-letter', 'ms65-saved-the-file'];
        runtime.commitServerCharacter({ ...saved, level: 88, storyProgress: 8, storyTraits: [...saved.storyTraits, proofs[index]] }, runtime.currentVersion() + 1);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(reader).toBeVisible();
        let sawRepair = false;
        for (let i = 0; i < 120 && await reader.count(); i++) {
            if (await reader.getByText(reaction.title, { exact: true }).count()) {
                sawRepair = true;
                if (index === 1) await expect(reader.getByRole('img', { name: 'Player', exact: true })).toHaveAttribute('src', uploadedAvatar);
                if (await reader.locator('.vn-choice-btn').count()) await expect(reader.locator('.vn-choice-btn').first()).toBeEnabled();
                await screenshot(page, info, `${villages[index]}-authored-payoff`);
            }
            await step(page);
        }
        expect(sawRepair).toBe(true);
        await expect(reader).toHaveCount(0);
        await expect.poll(() => runtime.lastCommit()?.postedState ?? '').toContain(repair.trait!);
        await expect.poll(() => JSON.parse(runtime.lastCommit()!.postedState).character.pendingStoryReports?.length ?? 0).toBe(0);
        await page.getByRole('button', { name: 'Enter Story Hall', exact: true }).click();
        const entry = page.locator('.story-archive-entry').filter({ hasText: payoff.title });
        await expect(entry).toBeVisible();
        await entry.locator('.story-archive-toggle').click();
        await expect(entry).toContainText(repair.text);
        await expect(entry).toContainText(reaction.dialogue[0]);
        await expect(entry).toContainText(reaction.speaker!);
        await entry.getByText(reaction.title, { exact: true }).scrollIntoViewIfNeeded();
        await screenshot(page, info, `${villages[index]}-payoff-archive`);
        if (index === 1) {
            const recorded = () => {
                const character = JSON.parse(runtime.lastCommit()!.postedState).character;
                return { choices: character.storyChoices, traits: character.storyTraits, progress: character.storyProgress };
            };
            const historyBeforeReplay = recorded();
            await entry.getByRole('button', { name: 'Watch cinematic replay' }).click();
            await expect(reader).toBeVisible();
            const avatar = reader.getByRole('img', { name: 'Player', exact: true });
            for (let i = 0; i < 40 && !(await avatar.isVisible()); i++) await step(page);
            await expect(avatar).toHaveAttribute('src', uploadedAvatar);
            await expect.poll(() => avatar.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
            await reader.getByRole('button', { name: /^Skip/ }).click();
            await expect(reader).toHaveCount(0);
            expect(recorded()).toEqual(historyBeforeReplay);
        }
    });
}
function completedFight(boss: string): SoloPveSession {
    const fighter = (name: string, hp: number, pos: number) => ({ name, hp, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100, shield: 0, statuses: [], pos, character: { level: 100, stats: {}, jutsu: [], pvpItems: [], equipment: {} } });
    return {
        runtime: 'solo-pve', schemaVersion: 1, sessionId: 'story-presentation-fixture', ownerSlug: 'auditninja',
        encounter: { kind: 'story-boss', id: 'fixture' }, player: fighter('AuditNinja', 85, 54), enemy: fighter(boss, 0, 55),
        round: 2, activeSide: 'player', ap: { player: 100, enemy: 0 }, actionsThisTurn: 1,
        cooldowns: { player: {}, enemy: {} }, groundEffects: [], itemCharges: {}, itemsUsed: {}, environment: { biome: 'forest', blockedTiles: [] },
        status: 'done', winner: 'player', outcome: 'win', settlementState: 'pending', log: ['Fixture: confirmed server victory.'], events: [], eventSeq: 0, version: 2,
        createdAt: Date.now(), lastActionAt: Date.now(), expiresAt: Date.now() + 600000, recentMoveTokens: [],
    };
}

test('Ashen Leaf finale continues through personal consequence, epilogue and immutable archive', async ({ page }, info) => {
    test.skip(before || !['chromium-mobile', 'chromium-compact', 'chromium-desktop'].includes(info.project.name));
    const content = contents[0];
    const chapter = content.chapters[8];
    const initial = uiAuditSave();
    initial.character = { ...initial.character, village: content.village, storyVillage: content.village, level: 100, storyProgress: 8,
        storyTraits: ['al88-better-winter-ready', 'al88-better-winter-carried', 'al88-reed-proof-any', 'al92-mori-present'], storyChoices: [], storyEpilogues: [], pendingStoryReports: [] };
    initial.triggeredEvents = [...initial.triggeredEvents as string[], ...content.interludes.map(scene => scene.id)];
    const runtime = await installUiAuditRuntime(page, initial);
    await readerPrefs(page);
    let starts = 0, settlements = 0, unlocks = 0;
    const session = completedFight(chapter.bossName);
    await page.route('**/api/story/boss-start', route => { starts++; return route.fulfill({ json: { ok: true, runId: session.sessionId, session } }); });
    await page.route('**/api/solo-pve/state?*', route => route.fulfill({ json: { session } }));
    await page.route('**/api/village/kage', route => {
        if (route.request().postDataJSON()?.action === 'unlock') unlocks++;
        return route.fulfill({ json: { ok: true, unlocked: true, seatedKage: 'ExistingChampion', firstLiberator: 'EarlierLiberator' } });
    });
    await page.route('**/api/story/settle', route => {
        settlements++;
        const saved = runtime.lastCommit() ? JSON.parse(runtime.lastCommit()!.postedState).character : initial.character;
        const character = { ...saved, storyProgress: 9, titles: ['Root Liberator'], inventory: [...saved.inventory, 'hollow-gate-key'] };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        return route.fulfill({ json: { ok: true, replayed: false, progress: 9, statPoints: 250, ryo: 7500, auraDust: 50,
            finale: true, title: 'Root Liberator', chronicleCards: ['fixture-witness-card'], character, _saveVersion: version,
            delivery: { battle: 'confirmed', personalReward: 'committed', combatRecord: 'confirmed', legacyRecord: 'confirmed' } } });
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const reader = page.locator('.cvn-root');
    await expect(reader).toBeVisible();
    await screenshot(page, info, 'finale-opening');
    const hub = chapter.pages![20];
    let proofRead = false;
    for (let i = 0; i < 150 && starts === 0; i++) {
        const proof = reader.getByRole('button', { name: hub.choices![0].text, exact: true });
        const battle = reader.getByRole('button', { name: hub.choices!.find(choice => choice.trait === 'honorable')!.text, exact: true });
        if (await proof.count() && !proofRead) {
            await expect(proof).toBeEnabled(); await proof.click(); proofRead = true;
        } else if (await battle.count()) {
            await expect(battle).toBeEnabled();
            await screenshot(page, info, 'finale-decision');
            // Same-frame repeated activation must record/start this finale once.
            await battle.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
        } else await step(page);
    }
    expect(proofRead).toBe(true);
    await expect.poll(() => starts).toBe(1);
    const result = page.locator('.story-fight-complete-card');
    await expect(result).toContainText('Title earned: Root Liberator');
    await expect(result).toContainText('+7,500 ryo');
    await expect(result).toContainText('Hollow Gate Key confirmed');
    await expect(result).not.toContainText(/seat stands open|first liberator|new Kage/i);
    await screenshot(page, info, 'finale-result');
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(reader).toBeVisible();
    await expect(reader).toContainText(/epilogue/i);
    await screenshot(page, info, 'finale-epilogue');
    for (let i = 0; i < 100 && await reader.count(); i++) await step(page);
    await expect(page.locator('.story-archive')).toBeVisible();
    await expect.poll(() => runtime.lastCommit()?.postedState ?? '').toContain('"status":"seen"');
    const entry = page.locator('.story-archive-entry').filter({ hasText: chapter.title });
    await entry.locator('.story-archive-toggle').click();
    await expect(entry).toContainText('Show her the better winter.');
    await entry.getByRole('button', { name: 'Watch cinematic replay' }).scrollIntoViewIfNeeded();
    await screenshot(page, info, 'finale-archive');
    const calls = { starts, settlements, unlocks };
    await entry.getByRole('button', { name: 'Watch cinematic replay' }).click();
    await expect(reader).toBeVisible();
    await expect(page.locator('.vn-choice-btn')).toHaveCount(0);
    for (let i = 0; i < 150 && await reader.count(); i++) await step(page);
    expect({ starts, settlements, unlocks }).toEqual(calls);
    expect(calls).toEqual({ starts: 1, settlements: 1, unlocks: 1 });
});

for (const [index, content] of contents.entries()) {
    test(`${villages[index]} opening through mounted reader, result, archive and immutable replay`, async ({ page }, info) => {
        test.skip(!['chromium-desktop', 'chromium-compact', 'chromium-mobile'].includes(info.project.name), 'three story acceptance viewports');
        const initial = uiAuditSave();
        initial.character = { ...initial.character, village: content.village, storyVillage: content.village, storyProgress: 0, storyTraits: [], storyChoices: [], storyEpilogues: [], seenHints: ['storyHall', 'village'] };
        initial.triggeredEvents = [...initial.triggeredEvents as string[], ...content.interludes.map(i => i.id)];
        const runtime = await installUiAuditRuntime(page, initial);
        await readerPrefs(page);
        let starts = 0, settlements = 0;
        let delivered = false;
        const session = completedFight(content.chapters[0].bossName);
        await page.route('**/api/story/boss-start', route => { starts++; return route.fulfill({ json: { ok: true, runId: session.sessionId, session } }); });
        await page.route('**/api/solo-pve/state?*', route => route.fulfill({ json: { session } }));
        await page.route('**/api/story/settle', route => {
            settlements++;
            const saved = runtime.lastCommit() ? JSON.parse(runtime.lastCommit()!.postedState).character : initial.character;
            const character = { ...saved, storyProgress: 1, ryo: 123456, auraDust: 6789 };
            const version = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(character, version);
            return route.fulfill({ status: delivered ? 200 : 503, json: delivered
                ? { ok: true, replayed: true, progress: 1, statPoints: 3, ryo: 75, auraDust: 12, finale: false, character, _saveVersion: version, delivery: { battle: 'confirmed', personalReward: 'committed', combatRecord: 'confirmed', legacyRecord: 'confirmed' } }
                : { error: 'Story reward committed; Legacy delivery pending.', rewardCommitted: true, settlement: { ok: true, replayed: settlements > 1, progress: 1, statPoints: 3, ryo: 75, auraDust: 12, finale: false, character, _saveVersion: version, delivery: { battle: 'confirmed', personalReward: 'committed', combatRecord: 'confirmed', legacyRecord: 'pending' } } } });
        });
        const storyRequests: string[] = [];
        page.on('response', response => {
            // Vite serves tiny ?url imports for each lazy URL; count only the
            // fetched canonical payload, just as the production loader does.
            if (/\/(?:assets|src\/generated\/story-content)\/(?:ashen-leaf|stormveil|frostfang|moonshadow)-.*json/.test(response.url())
                && response.headers()['content-type']?.includes('application/json')) storyRequests.push(response.url());
        });
        await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('.cvn-root')).toBeVisible();
        await screenshot(page, info, `${villages[index]}-opening`);
        for (let i = 0; i < 80 && starts === 0; i++) {
            if (await page.locator('.vn-choice-btn').count()) {
                await expect(page.locator('.vn-choice-btn').first()).toBeEnabled();
                await screenshot(page, info, `${villages[index]}-choices`);
            }
            await step(page, 0);
        }
        await expect.poll(() => starts).toBe(1);
        const result = page.locator('.story-fight-complete-card');
        await expect(result).toBeVisible();
        const retry = result.getByRole('button', { name: before ? 'Retry Reward' : 'Retry Record Delivery' });
        await expect(retry).toBeEnabled();
        if (!before) {
            await expect(result).toContainText('75 ryo');
            await expect(result).toContainText('Legacy contribution delivery is pending');
            await expect(result).not.toContainText('123,456');
        }
        await screenshot(page, info, `${villages[index]}-partial-result`);
        delivered = true;
        await retry.click();
        await expect(result.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled();
        await result.getByRole('button', { name: 'Continue', exact: true }).click();
        // This accelerated fixture qualifies for the next chapter. Dismiss it
        // through the supported reader action before opening completed stories.
        await expect(page.locator('.cvn-root')).toBeVisible();
        await page.locator('.cvn-root').getByRole('button', { name: 'Skip', exact: true }).click();
        await page.getByRole('button', { name: 'Enter Story Hall', exact: true }).click();
        const entry = page.locator('.story-archive-entry').filter({ hasText: content.chapters[0].title });
        await expect(entry).toBeVisible();
        await entry.locator('.story-archive-toggle').click();
        await expect(entry).toContainText(content.chapters[0].pages![1].choices![0].text);
        await expect(page.locator('body')).not.toContainText(content.chapters[1].title);
        const calls = { starts, settlements };
        await entry.getByRole('button', { name: 'Watch cinematic replay' }).click();
        await expect(page.locator('.cvn-root')).toBeVisible();
        await screenshot(page, info, `${villages[index]}-replay`);
        await expect(page.locator('.vn-choice-btn')).toHaveCount(0);
        for (let i = 0; i < 80 && await page.locator('.cvn-root').count(); i++) await step(page);
        expect({ starts, settlements }).toEqual(calls);
        expect(new Set(storyRequests).size).toBe(1);
        const metrics = JSON.stringify({ village: content.village, viewport: info.project.name,
            combat: 'seeded completed server session; real settlement handler tested separately', starts, settlements,
            canonicalVillagePayloadResponses: storyRequests.length,
            canonicalVillagePayloads: [...new Set(storyRequests)], replayExtraStarts: 0, replayExtraSettlements: 0 }, null, 2);
        writeFileSync(path.join(evidenceDirectory, `${villages[index]}-requests-${info.project.name}.json`), metrics);
        await info.attach('fixture-contract', { body: metrics, contentType: 'application/json' });
    });
}

test('pending choices stay outside the completed archive and current membership owns shared records', async ({ page }, info) => {
    const content = contents[0];
    const interlude = content.interludes.find(i => i.levelReq === 30)!;
    const final = interlude.pages.length - 1;
    const choice = interlude.pages[final].choices![0];
    const initial = uiAuditSave();
    initial.triggeredEvents = [...initial.triggeredEvents as string[], ...content.interludes.map(i => i.id)];
    initial.character = { ...initial.character, village: 'Stormveil Village', storyVillage: content.village, storyProgress: 8,
        storyTraits: [choice.trait], totalTilesExplored: 42,
        storyChoices: [{ version: 1, eventId: interlude.id, pageId: `v1:p${final}`, choiceId: 'v1:c0', pageIndex: final, choiceIndex: 0, nextPage: final, trait: choice.trait }],
        pendingStoryReports: [{ version: 1, kind: 'interlude', eventId: interlude.id, trait: choice.trait }],
    };
    await installUiAuditRuntime(page, initial);
    await page.route('**/api/story/interlude', route => route.fulfill({ status: 503, json: { error: 'fixture: pending' } }));
    await page.goto('/#/storyHall', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.story-archive')).toBeVisible();
    if (!before) {
        await expect(page.locator('.story-archive-history-note')).toContainText('awaits the permanent Chronicle record');
        await expect(page.locator('.story-archive-entry').filter({ hasText: interlude.title })).toHaveCount(0);
    }
    await page.locator('.story-archive-guidance').scrollIntoViewIfNeeded();
    await screenshot(page, info, 'pending-archive');
    await page.getByRole('button', { name: 'Living Chronicle', exact: true }).click();
    await expect(page.locator('.story-living-chronicle')).toBeVisible();
    if (!before) {
        await expect(page.locator('.story-living-chronicle')).toContainText('42 exploration actions completed');
        await expect(page.locator('.chronicle-record-heading').filter({ hasText: 'VILLAGE RECORD' })).toContainText('Stormveil Village');
    }
    await page.getByText(before ? '42 sectors explored' : '42 exploration actions completed', { exact: false }).scrollIntoViewIfNeeded();
    await screenshot(page, info, 'chronicle-totals');
});

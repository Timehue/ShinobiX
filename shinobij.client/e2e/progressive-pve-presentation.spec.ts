import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rollOrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter';
import { STANDARD_PVE_AI_POLICY } from '../../api/solo-pve/_ai-turn-policy';
import { applySoloPveAction } from '../../api/solo-pve/_engine';
import { hexNeighbors } from '../../api/combat-core/grid';
import { aiStatsForLevel } from '../../api/_ai-level-curves';
import { ordinaryAiProfile } from '../../api/missions/_ordinary-ai-encounter';
import { storyBossEnemyTemplate } from '../../api/story/_authoritative-story-combat';
import { STORY_KAGE_ENCOUNTERS } from '../../shared/story-kage';
import { storyInterludesByVillage } from '../src/data/story-interludes';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Production browser components and actual image bytes, with isolated network
// fixtures. The real resolver supplies the terminal event; no live saves or
// combat endpoints are used. One-HP enemies make this a presentation regression,
// independent of the separate seeded balance audit.
test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(info.project.name), 'Desktop and phone presentation coverage.');
});

async function screenshot(page: Page, info: TestInfo, state: string) {
    const directory = resolve(import.meta.dirname, '../../.tmp/progressive-pve-browser');
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, `${info.project.name}-${state}.png`);
    await page.screenshot({ path });
    await info.attach(state, { path, contentType: 'image/png' });
}

async function readableImage(image: Locator, expectedPath: string) {
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect.poll(() => image.evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth >= 128 && image.naturalHeight >= 128;
    })).toBe(true);
}

async function installEncounter(page: Page, kind: 'ordinary' | 'final', rollingLog = false) {
    const save = uiAuditSave();
    save.character = {
        ...save.character, level: 100, stats: aiStatsForLevel(100),
        hp: 10_000, maxHp: 10_000, chakra: 10_000, maxChakra: 10_000,
        stamina: 10_000, maxStamina: 10_000, bloodline: 'None',
        equippedJutsuIds: [], jutsuMastery: [], equipment: {}, pets: [],
    };
    // The shared audit save is level85. A level100 combat fixture has already
    // completed its later interludes; otherwise their asynchronous VN overlay
    // can cover the resumed encounter after its DOM first becomes visible.
    save.triggeredEvents = [...save.triggeredEvents, ...storyInterludesByVillage['Stormveil Village'].map(interlude => interlude.id)];
    const runtime = await installUiAuditRuntime(page, save);
    const descriptor = rollOrdinaryPveEncounter({
        sourceId: 'browser-sealed-discovery', playerLevel: 100, sector: 60,
        seed: 'browser-sealed-discovery', archetype: 'assassin',
        displayName: 'Rogue Assassin', portraitKey: 'assassin', portraitImage: '/portraits/pve/assassin.webp',
    });
    const profile = kind === 'final'
        ? storyBossEnemyTemplate({ village: 'Stormveil Village', progressIndex: 8 })
        : ordinaryAiProfile(descriptor);
    let session = buildSoloPveAiEncounter({
        sessionId: `browser-progressive-${kind}`, playerName: 'auditninja', save,
        profile, now: Date.now(), admin: null, difficultyMode: kind === 'final' ? 'STORY' : 'AI_FIGHT',
        aiTurnPolicy: STANDARD_PVE_AI_POLICY,
        encounter: { kind: kind === 'final' ? 'story-boss' : 'generic-ai', id: profile.id, sourceId: profile.id },
        env: { DISABLE_PVE_AI_PLANNER: '' },
    });
    if (kind === 'ordinary') session.enemy.hp = 1;
    session.enemy.pos = hexNeighbors(session.player.pos)[0];
    if (rollingLog) {
        session.round = 10;
        session.log = [...Array<string>(12).fill('80 damage to Enemy.'), ...[7, 8, 9, 10].flatMap(round => [
            `--- Round ${round} ---`, 'auditninja uses Basic Attack:', ...Array<string>(10).fill('80 damage to Enemy.'),
        ])];
    }
    const sealed = () => ({
        token: `browser-token-${kind}`, sessionId: session.sessionId, session,
        opponentId: profile.id, opponentName: session.enemy.name, battleKind: 'practice', resumed: true,
        ...(kind === 'ordinary' ? { encounter: descriptor } : {}),
    });
    let resumeCount = 0;
    await page.route('**/api/missions/ai-fight-start', async route => {
        const body = route.request().postDataJSON();
        if (body.resumeWorldFight) return route.fulfill({ status: 204 });
        resumeCount++;
        return route.fulfill({ json: sealed() });
    });
    await page.route('**/api/solo-pve/state?**', route => route.fulfill({ json: { session } }));
    await page.route('**/api/solo-pve/action', async route => {
        const body = route.request().postDataJSON();
        const result = applySoloPveAction(session, body);
        expect(result.applied, JSON.stringify({ body, reason: result.reason })).toBe(true);
        session = { ...result.session, version: session.version + 1 };
        return route.fulfill({ json: { ...result, session } });
    });
    await page.route('**/api/missions/report-ai-fight', async route => {
        expect(session.winner).toBe('player');
        const character = { ...save.character, hp: session.player.hp };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        return route.fulfill({ json: {
            ok: true, outcome: 'win', xp: 0, ryo: 0, statPoints: 0,
            character, _saveVersion: version, ...(kind === 'ordinary' ? { encounter: descriptor } : {}),
        } });
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#combat')).toBeVisible({ timeout: 60_000 });
    return { descriptor, name: session.enemy.name, level: Number(session.enemy.character.level),
        resumeCount: () => resumeCount, session: () => session };
}

test('sealed ordinary identity, level and real portrait survive refresh, victory and debug export', async ({ page }, info) => {
    test.setTimeout(120_000);
    const encounter = await installEncounter(page, 'ordinary');
    const dossier = () => page.getByRole('complementary', { name: `${encounter.name} combat status`, exact: true });
    const badge = () => page.locator(`.encounter-difficulty[data-encounter-id="${encounter.descriptor.id}"]`).first();
    await expect(dossier()).toBeVisible();
    await expect(badge()).toBeVisible();
    await expect(badge()).toContainText(`Lv ${encounter.level}`);
    await expect(badge()).toContainText(/Weaker opponent|Standard opponent|Dangerous opponent|Elite opponent/);
    await readableImage(dossier().locator('.combat-avatar img'), '/portraits/pve/assassin.webp');
    await screenshot(page, info, 'ordinary-resumed');

    const resumesBeforeReload = encounter.resumeCount();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(dossier()).toBeVisible({ timeout: 60_000 });
    await expect.poll(encounter.resumeCount).toBeGreaterThan(resumesBeforeReload);
    await expect(badge()).toBeVisible();
    await expect(badge()).toContainText(`Lv ${encounter.level}`);
    await readableImage(dossier().locator('.combat-avatar img'), '/portraits/pve/assassin.webp');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await screenshot(page, info, 'ordinary-refreshed');

    const logTab = page.getByRole('tab', { name: /Battle log/i });
    if (await logTab.isVisible()) await logTab.click();
    await expect(page.getByRole('button', { name: /^Export (log|partial)$/ })).toBeVisible();
    await screenshot(page, info, 'ordinary-log');
    const actionsTab = page.getByRole('tab', { name: 'Actions', exact: true });
    if (await actionsTab.isVisible()) await actionsTab.click();

    await page.getByRole('button', { name: /^Attack\b/ }).click();
    const victory = page.getByRole('dialog', { name: 'Fight won', exact: true });
    await expect(victory).toBeVisible({ timeout: 30_000 });
    await expect(victory.getByRole('heading')).toHaveText(`${encounter.name} defeated.`);
    await expect(victory.locator('.encounter-difficulty')).toContainText(`Lv ${encounter.level}`);
    await readableImage(victory.locator('img'), '/portraits/pve/assassin.webp');
    const downloadEvent = page.waitForEvent('download');
    await victory.getByRole('button', { name: 'Export observed log', exact: true }).click();
    const download = await downloadEvent;
    const path = await download.path();
    expect(path).not.toBeNull();
    const text = readFileSync(path!, 'utf8');
    expect(text).toContain(`${encounter.name} (Lv ${encounter.level})`);
    expect(text).toContain(encounter.session().sessionId);
    expect(text).toContain('HP');
    expect(text).toContain('AP');
    expect(text).toContain('outcome: win');
    await info.attach('exported-battle-log', { body: Buffer.from(text), contentType: 'text/plain' });
    await screenshot(page, info, 'ordinary-victory');
});

test('rolling battle log shows actual round and visible partial retention counts on desktop and phone', async ({ page }, info) => {
    test.setTimeout(120_000);
    await installEncounter(page, 'ordinary', true);
    const logTab = page.getByRole('tab', { name: /Battle log/i });
    if (await logTab.isVisible()) await logTab.click();
    const summary = page.locator('#combat .combat-log-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText('Round 10 · 5 retained rounds · 56 retained events · Partial view');
    expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth + 1
        && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await screenshot(page, info, 'rolling-log-retention');
});

test('final Kage canonical art, highest difficulty and readable tell details render on desktop and phone', async ({ page }, info) => {
    test.setTimeout(120_000);
    const encounter = await installEncounter(page, 'final');
    const authored = STORY_KAGE_ENCOUNTERS['Stormveil Village'];
    const dossier = page.getByRole('complementary', { name: `${encounter.name} combat status`, exact: true });
    await expect(dossier).toBeVisible();
    await readableImage(dossier.locator('.combat-avatar img'), authored.portrait);
    await expect(page.locator('#combat .encounter-difficulty')).toHaveText('Final Kage - Apex tactics');
    await expect(page.locator('#combat .encounter-difficulty')).toBeVisible();
    const stripBounds = await page.locator('.combat-grid-environment').boundingBox();
    const tellBounds = await page.locator('#encounter-details-trigger').boundingBox();
    expect(stripBounds).not.toBeNull();
    expect(tellBounds).not.toBeNull();
    expect(tellBounds!.y).toBeGreaterThanOrEqual(stripBounds!.y - 1);
    expect(tellBounds!.y + tellBounds!.height).toBeLessThanOrEqual(stripBounds!.y + stripBounds!.height + 1);
    await screenshot(page, info, 'kage-combat');
    await page.locator('#encounter-details-trigger').click();
    const details = page.locator('#encounter-details');
    await expect(details).toBeVisible();
    await expect(details).toContainText(authored.tell);
    await expect(details).toContainText('seven-round cooldown');
    const bounds = await details.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await screenshot(page, info, 'kage-tells');
});

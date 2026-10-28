import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter';
import { applySoloPveAction } from '../../api/solo-pve/_engine';
import { STANDARD_PVE_AI_POLICY } from '../../api/solo-pve/_ai-turn-policy';
import { aiStatsForLevel } from '../../api/_ai-level-curves';
import { ordinaryAiProfile } from '../../api/missions/_ordinary-ai-encounter';
import { rollOrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter';
import { hexNeighbors } from '../../api/combat-core/grid';
import { storyInterludesByVillage } from '../src/data/story-interludes';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const UNSEEN = 'story-interlude-stormveil-village-92';
const scene = (page: Page) => page.getByRole('dialog', { name: 'The Coast Road visual novel scene', exact: true });

test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || info.project.name !== 'chromium-desktop', 'Mounted App lifecycle coverage on Chromium.');
});

async function resumeFixture(page: Page, mode: 'active' | 'empty' | 'failure-retry') {
    const save = uiAuditSave();
    save.character = { ...save.character, level: 92, storyProgress: 8, stats: aiStatsForLevel(92),
        equippedJutsuIds: [], jutsuMastery: [], equipment: {}, pets: [], storyTraits: [] };
    save.triggeredEvents = [...save.triggeredEvents.filter(id => id !== UNSEEN),
        ...storyInterludesByVillage['Stormveil Village'].filter(interlude => interlude.levelReq < 92).map(interlude => interlude.id)];
    expect(save.triggeredEvents).not.toContain(UNSEEN);
    const runtime = await installUiAuditRuntime(page, save);
    const descriptor = rollOrdinaryPveEncounter({ sourceId: 'resumed-unseen-story', playerLevel: 92, sector: 66,
        seed: 'resumed-unseen-story', archetype: 'assassin', displayName: 'Rogue Assassin',
        portraitKey: 'assassin', portraitImage: '/portraits/pve/assassin.webp' });
    const profile = ordinaryAiProfile(descriptor);
    let session = buildSoloPveAiEncounter({ sessionId: 'resumed-unseen-story', playerName: 'auditninja', save, profile,
        now: Date.now(), admin: null, difficultyMode: 'AI_FIGHT', aiTurnPolicy: STANDARD_PVE_AI_POLICY,
        encounter: { kind: 'generic-ai', id: profile.id, sourceId: profile.id }, env: { DISABLE_PVE_AI_PLANNER: '' } });
    session.enemy.hp = 1; // Presentation terminal event only; no balance assertion.
    session.enemy.pos = hexNeighbors(session.player.pos)[0];
    let release!: () => void;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let worldProbes = 0, genericProbes = 0, completions = 0, settled = false;
    await page.route('**/api/story/interlude', route => { completions++; return route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/missions/ai-fight-start', async route => {
        const body = route.request().postDataJSON();
        if (body.resumeWorldFight) {
            worldProbes++;
            if (mode === 'failure-retry') {
                if (worldProbes === 1) return route.fulfill({ status: 503, json: { error: 'temporary local test failure' } });
                await delayed;
            }
            return route.fulfill({ status: 204 });
        }
        expect(body.resumeAiFight).toBe(true);
        genericProbes++;
        if (mode !== 'failure-retry') await delayed;
        if (mode === 'empty' || settled) return route.fulfill({ status: 204 });
        return route.fulfill({ json: { token: 'resumed-unseen-story', sessionId: session.sessionId, session,
            opponentId: profile.id, opponentName: session.enemy.name, battleKind: 'explore', resumed: true,
            worldExploreRequestId: 'resumed-unseen-story', encounter: descriptor, sector: 66 } });
    });
    await page.route('**/api/solo-pve/state?**', route => route.fulfill({ json: { session } }));
    await page.route('**/api/solo-pve/action', route => {
        const result = applySoloPveAction(session, route.request().postDataJSON());
        expect(result.applied).toBe(true);
        session = { ...result.session, version: session.version + 1 };
        return route.fulfill({ json: { ...result, session } });
    });
    await page.route('**/api/missions/report-ai-fight', route => {
        expect(session.winner).toBe('player');
        settled = true;
        const character = { ...runtime.serverSave().character, hp: session.player.hp };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        return route.fulfill({ json: { ok: true, outcome: 'win', xp: 0, ryo: 0, statPoints: 0,
            character, _saveVersion: version, encounter: descriptor } });
    });
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.app-shell[data-screen="worldMap"]')).toBeVisible();
    return { release, worldProbes: () => worldProbes, genericProbes: () => genericProbes,
        assertUnseen: () => {
            expect(runtime.serverSave().triggeredEvents).not.toContain(UNSEEN);
            expect(completions).toBe(0);
        } };
}

async function finishAndReoffer(page: Page, info: TestInfo) {
    await expect(page.locator('#combat')).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sealed-fight-engaged', 'true');
    await expect(scene(page)).toHaveCount(0);
    await info.attach('resumed-combat-without-story-overlay', { body: await page.screenshot(), contentType: 'image/png' });
    await page.locator('#combat').getByRole('button', { name: /^Attack\b/ }).click();
    await page.locator('#combat button.hex-tile.hex-enemy.jutsu-target-tile').click();
    const result = page.getByRole('dialog', { name: 'Fight won', exact: true });
    await expect(result).toBeVisible();
    await expect(scene(page)).toHaveCount(0);
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.locator('#combat')).toHaveCount(0);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sealed-fight-engaged', 'false');
    await expect(scene(page)).toBeVisible();
    await info.attach('unseen-story-reoffered-after-combat', { body: await page.screenshot(), contentType: 'image/png' });
}

test('an unseen real level92 interlude waits through delayed authoritative resume and returns after combat', async ({ page }, info) => {
    test.setTimeout(90_000);
    const fixture = await resumeFixture(page, 'active');
    await expect.poll(fixture.genericProbes).toBe(1);
    // The network window intentionally exceeds several story-loader/effect
    // turns. The old host opens this eligible VN over the pending world map.
    await page.waitForTimeout(1_000);
    await expect(scene(page)).toHaveCount(0);
    fixture.assertUnseen();
    fixture.release();
    await finishAndReoffer(page, info);
    fixture.assertUnseen();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(scene(page)).toBeVisible();
    fixture.assertUnseen();
});

test('empty world and generic recovery probes release the unseen interlude', async ({ page }) => {
    test.setTimeout(90_000);
    const fixture = await resumeFixture(page, 'empty');
    await expect.poll(fixture.genericProbes).toBe(1);
    await page.waitForTimeout(500);
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sealed-fight-engaged', 'true');
    await expect(scene(page)).toHaveCount(0);
    fixture.release();
    await expect(scene(page)).toBeVisible();
    await expect(page.locator('.app-shell')).toHaveAttribute('data-sealed-fight-engaged', 'false');
    await expect(page.locator('#combat')).toHaveCount(0);
    fixture.assertUnseen();
});

test('failed recovery releases narrative; retry defers its already-open scene without consuming it', async ({ page }, info) => {
    test.setTimeout(90_000);
    const fixture = await resumeFixture(page, 'failure-retry');
    await expect(scene(page)).toBeVisible({ timeout: 4_500 });
    fixture.assertUnseen();
    await expect.poll(fixture.worldProbes, { timeout: 10_000 }).toBe(2);
    await expect(scene(page)).toHaveCount(0);
    fixture.assertUnseen();
    fixture.release();
    await finishAndReoffer(page, info);
    fixture.assertUnseen();
});

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTowerEncounter } from '../../api/towers/_encounter';
import { checkTowerWinner, startRound } from '../../api/towers/_engine';
import { getFloor } from '../../api/towers/_floor-catalog';
import { publicTowerFloorMeta } from '../../api/towers/floors';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// A real Floor 10 run, transformed by the authoritative engine, rendered by the
// production tower screen. Network fixtures only; no live saves.
test.beforeEach(({ browserName }, info) => {
    test.skip(browserName !== 'chromium' || !['chromium-desktop', 'chromium-mobile'].includes(info.project.name), 'Desktop and phone presentation coverage.');
});

async function screenshot(page: Page, info: TestInfo, state: string) {
    const directory = resolve(import.meta.dirname, '../../.tmp/boss-transformation-tower');
    mkdirSync(directory, { recursive: true });
    const path = resolve(directory, `${info.project.name}-${state}.png`);
    await page.screenshot({ path });
    await info.attach(state, { path, contentType: 'image/png' });
}

async function loaded(image: Locator, expectedPath: string) {
    await expect(image).toHaveAttribute('src', new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await expect.poll(() => image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth >= 128;
    })).toBe(true);
}

test('the Spire Sovereign transforms: cut-scene first, then the new portrait, sprite, aura and phase, once', async ({ page }, info) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const save = uiAuditSave();
    await installUiAuditRuntime(page, save);
    const floor = getFloor(10)!;
    const runId = 'tower-transformation-f10';
    const session = buildTowerEncounter({ floor, runId, seed: 42, partySize: 1, now: Date.now(), embedFloor: true,
        squad: [{ id: 'sq-0', name: 'AuditNinja', ownerSlug: 'auditninja', ai: false, character: save.character! }] });
    startRound(session);
    session.activeIndex = session.turnQueue.indexOf('sq-0');
    session.activeAp = 100;
    // Cross the 50% gate through the real engine: the Sovereign enters its form.
    const boss = session.actors.find(actor => actor.id === session.phaseState.bossId)!;
    boss.hp = Math.floor(boss.maxHp * 0.45);
    checkTowerWinner(session, floor);
    expect(session.status).toBe('active');
    expect(session.bossForms?.phase).toBe(1);
    const form = session.bossForms!.plan.phases[0]!;

    await page.route('**/api/towers/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/floors')) return route.fulfill({ json: { floors: [publicTowerFloorMeta(floor)] } });
        if (path.endsWith('/my-run')) return route.fulfill({ json: { runId, session } });
        if (path.endsWith('/party')) return route.fulfill({ json: { ok: true, party: null, invitations: [], publicParties: [] } });
        return route.fulfill({ json: { applied: true, session, actionVersion: session.actionVersion } });
    });
    await page.addInitScript(() => localStorage.setItem('lastScreen.v1', 'battleTowers'));
    await page.addInitScript(id => localStorage.setItem('shinobix:towerRunId', id), runId);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const combat = page.locator('.screen-battleTowerFight');
    await expect(combat).toBeVisible({ timeout: 60_000 });

    const scene = page.getByRole('dialog', { name: `${form.formName} visual novel scene` });
    await expect(scene).toBeVisible({ timeout: 30_000 });
    await expect(scene.locator('.cvn-speaker')).toHaveText(form.cutscene.speaker);
    // The first line shows the Sovereign as it was; the new form is not drawn yet.
    const sceneBoss = scene.locator('figure img').last();
    await expect(sceneBoss).not.toHaveAttribute('src', new RegExp(form.portrait!));
    const token = combat.locator(`[id="tower-board-actor-${boss.id}"]`);
    await expect(token.locator(`img[src*="${form.sprite}"]`)).toHaveCount(0);
    await screenshot(page, info, 'cutscene-before');
    await scene.getByRole('button', { name: 'Next', exact: true }).click();
    await loaded(sceneBoss, form.portrait!);
    await screenshot(page, info, 'cutscene-after');
    for (let line = 1; line < form.cutscene.lines.length; line++) await scene.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(scene.locator('.cvn-dialogue-text')).toContainText(form.mechanic!.name);
    await scene.getByRole('button', { name: 'Resume battle', exact: true }).click();
    await expect(scene).toBeHidden();

    const intro = page.getByRole('button', { name: 'Enter battle', exact: true });
    if (await intro.isVisible()) await intro.click();
    await screenshot(page, info, 'transformed');
    const chip = combat.locator('.boss-form-chip:visible');
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText('Phase 2/2');
    await expect(chip).toContainText(form.formName);
    await loaded(token.locator(`img[src*="${form.sprite}"]`).first(), form.sprite!);
    await expect(token.locator('.boss-form-ring')).toHaveCount(1);
    // Every portrait of the boss (dossier, roster card) now uses the form art; phones keep those rails collapsed.
    await expect.poll(() => combat.locator(`img[src*="${form.portrait}"]`).count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    // A refresh keeps the form and does not replay the scene.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(chip).toContainText(form.formName, { timeout: 60_000 });
    await expect(page.getByRole('dialog', { name: `${form.formName} visual novel scene` })).toHaveCount(0);
    await expect(token.locator(`img[src*="${form.sprite}"]`).first()).toBeVisible();
    expect(errors).toEqual([]);
});

import { test, expect, type Page } from '@playwright/test';
import type { CombatJutsu } from '../../api/combat-core/types';

const fixture = '/e2e/fixtures/arena-practice.html';
function session(level = 100, terminal = false) {
    const fighter = (name: string, pos: number) => ({ name, pos, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500, shield: 0, statuses: [], character: { name, level, specialty: 'Ninjutsu',
            stats: {}, jutsu: [] as CombatJutsu[], pvpItems: [], equipment: {} } });
    return { runtime: 'solo-pve', schemaVersion: 1, sessionId: 'practice-qa', ownerSlug: 'arenadiver',
        encounter: { kind: 'generic-ai', id: 'builtin-ai-central-champion', level, metadata: { spar: true } },
        player: fighter('ArenaDiver', 26), enemy: { ...fighter('Central Champion', 27), hp: terminal ? 0 : 9292, maxHp: 9292 },
        round: terminal ? 10 : 1, activeSide: 'player', ap: { player: 100, enemy: 100 }, actionsThisTurn: 0,
        cooldowns: { player: {}, enemy: {} }, groundEffects: [], itemCharges: {}, itemsUsed: {},
        environment: { biome: 'central', blockedTiles: [] }, status: terminal ? 'done' : 'active', winner: terminal ? 'player' : null,
        outcome: terminal ? 'win' : null, settlementState: 'pending', log: [], events: [], eventSeq: 0, version: terminal ? 2 : 1,
        recentMoveTokens: [], createdAt: Date.now(), lastActionAt: Date.now(), expiresAt: Date.now() + 600000 };
}

async function mock(page: Page, buffTile?: 'stationary' | 'move') {
    let active: ReturnType<typeof session> | null = null;
    let settled = false, reports = 0, starts = 0;
    let release: (() => void) | null = null;
    let holdSettlement = false;
    const selected: number[] = [];
    await page.addInitScript(() => { localStorage.setItem('battleLock.activeId.v1', 'persisted-orphan-compatibility-marker'); });
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        const body = route.request().postDataJSON() ?? {};
        const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
        if (path === '/api/missions/ai-fight-start') {
            if (body.resumeWorldFight) return route.fulfill({ status: 204 });
            if (body.resumeAiFight && !active) return route.fulfill({ status: 204 });
            if (!active) {
                selected.push(body.practiceLevel); active = session(body.practiceLevel); starts++;
                if (buffTile) active.player.character.jutsu = [{
                    id: 'golden-ground', name: 'Golden Ground', type: 'Any', target: 'EMPTY_GROUND', method: 'INSTANT_EFFECT',
                    ap: 40, range: 4, effectPower: 0, cooldown: 2, chakraCost: 0, staminaCost: 0,
                    tags: [...(buffTile === 'move' ? [{ name: 'Move' }] : []), { name: 'Reflect', percent: 30 }],
                }];
            }
            return reply({ token: 'practice-token', sessionId: active.sessionId, session: active, opponentId: 'builtin-ai-central-champion',
                opponentName: 'Central Champion', battleKind: 'practice', resumed: !!body.resumeAiFight });
        }
        if (path === '/api/solo-pve/state') return reply({ session: active });
        if (path === '/api/solo-pve/action') { active = session(active?.enemy.character.level, true); return reply({ applied: true, session: active }); }
        if (path === '/api/missions/report-ai-fight') {
            reports++;
            if (holdSettlement) await new Promise<void>(resolve => { release = resolve; });
            settled = true; active = null;
            return reply({ ok: true, outcome: 'win', xp: 0, ryo: 0, statPoints: 0, capped: false, fetchMissionsCredited: [],
                character: { name: 'ArenaDiver', level: 100, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500,
                    stamina: 500, maxStamina: 500, ryo: 456, xp: 0, stats: {}, inventory: [], itemStacks: [], equipment: {}, pets: [] }, _saveVersion: 2 });
        }
        return reply({ enabled: false, inQueue: false, queueSize: 0 });
    });
    return { get selected() { return selected; }, get starts() { return starts; }, get reports() { return reports; }, get settled() { return settled; },
        hold() { holdSettlement = true; }, release() { holdSettlement = false; release?.(); } };
}

for (const buffTile of ['stationary', 'move'] as const) {
    test(`${buffTile} buff tile highlights only legal caster and empty hex targets`, async ({ page }, testInfo) => {
        await mock(page, buffTile);
        await page.goto(fixture);
        await page.getByRole('button', { name: 'Start AI battle' }).click();
        const combat = page.locator('.mission-arena-fight');
        const jutsu = combat.locator('.combat-jutsu-button').filter({ hasText: 'Golden Ground' });
        await expect(jutsu).toBeEnabled();
        await jutsu.click();
        const ownTile = combat.locator('button.hex-tile.hex-player');
        const enemyTile = combat.locator('button.hex-tile.hex-enemy');
        await expect(enemyTile).not.toHaveClass(/ground-target-tile|dash-target-tile/);
        if (buffTile === 'stationary') {
            await expect(ownTile).toHaveClass(/ground-target-tile/);
            await expect(ownTile).toHaveAccessibleName(/your position, ground target/);
            await ownTile.focus();
            await expect(ownTile).toHaveClass(/mission-ground-preview-sanctuary/);
            await page.screenshot({ path: testInfo.outputPath('buff-tile-under-caster.png') });
            const submitted = page.waitForRequest(request => request.url().includes('/api/solo-pve/action') && request.method() === 'POST');
            await ownTile.press('Enter');
            expect((await submitted).postDataJSON()).toMatchObject({ type: 'jutsu', jutsuId: 'golden-ground', tile: 26 });
        } else {
            await expect(ownTile).not.toHaveClass(/ground-target-tile|dash-target-tile/);
            await expect(combat.locator('button.dash-target-tile').first()).toBeVisible();
        }
    });
}

test('selected level 100 is sealed, survives reconnect and releases navigation only after settlement and Continue', async ({ page }) => {
    const server = await mock(page);
    await page.goto(fixture);
    await expect(page.getByRole('spinbutton')).toHaveValue('100');
    await page.getByRole('button', { name: 'Start AI battle' }).click();
    await expect(page.getByRole('button', { name: /^Attack/ })).toBeVisible();
    expect(server.selected).toEqual([100]);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Attack/ })).toBeVisible();
    expect(server.starts).toBe(1);
    server.hold();
    await page.getByRole('button', { name: /^Attack/ }).click();
    await page.locator('#combat button.hex-tile.hex-enemy.jutsu-target-tile').click();
    const result = page.getByRole('dialog', { name: 'Fight won' });
    await expect(result).toBeVisible();
    await expect(result.getByText('Lv 100', { exact: true })).toBeVisible();
    await expect(result.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await page.getByTestId('arena-village').evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByTestId('arena-notice')).toHaveText('Finish this fight before you leave.');
    await expect(page.getByTestId('arena-screen')).toHaveText('arena');
    server.release();
    await expect(result.getByText('Practice bout — no rewards.', { exact: true })).toBeVisible();
    await result.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(result).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start AI battle' })).toBeVisible();
    await page.getByTestId('arena-village').click();
    await expect(page.getByRole('heading', { name: 'Village reached' })).toBeVisible();
    expect(server.reports).toBe(1);
    expect(server.settled).toBe(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Village reached' })).toBeVisible();
    await expect(page.getByTestId('arena-hp')).toHaveText('10000');
    expect(server.reports).toBe(1);
    expect(server.starts).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('battleLock.activeId.v1'))).toBe('persisted-orphan-compatibility-marker');
});

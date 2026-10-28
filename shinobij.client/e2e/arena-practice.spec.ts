import { test, expect, type Page } from '@playwright/test';

const fixture = '/e2e/fixtures/arena-practice.html';
function session(level = 100, terminal = false) {
    const fighter = (name: string, pos: number) => ({ name, pos, hp: 10000, maxHp: 10000, chakra: 500, maxChakra: 500,
        stamina: 500, maxStamina: 500, shield: 0, statuses: [], character: { name, level, specialty: 'Ninjutsu',
            stats: {}, jutsu: [], pvpItems: [], equipment: {} } });
    return { runtime: 'solo-pve', schemaVersion: 1, sessionId: 'practice-qa', ownerSlug: 'arenadiver',
        encounter: { kind: 'generic-ai', id: 'builtin-ai-central-champion', level, metadata: { spar: true } },
        player: fighter('ArenaDiver', 26), enemy: { ...fighter('Central Champion', 27), hp: terminal ? 0 : 9292, maxHp: 9292 },
        round: terminal ? 10 : 1, activeSide: 'player', ap: { player: 100, enemy: 100 }, actionsThisTurn: 0,
        cooldowns: { player: {}, enemy: {} }, groundEffects: [], itemCharges: {}, itemsUsed: {},
        environment: { biome: 'central', blockedTiles: [] }, status: terminal ? 'done' : 'active', winner: terminal ? 'player' : null,
        outcome: terminal ? 'win' : null, settlementState: 'pending', log: [], events: [], eventSeq: 0, version: terminal ? 2 : 1,
        recentMoveTokens: [], createdAt: Date.now(), lastActionAt: Date.now(), expiresAt: Date.now() + 600000 };
}

async function mock(page: Page) {
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
            if (!active) { selected.push(body.practiceLevel); active = session(body.practiceLevel); starts++; }
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

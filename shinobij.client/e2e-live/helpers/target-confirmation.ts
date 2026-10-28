import { expect, type Locator, type Page } from '@playwright/test';

/** Exercise the mounted screen without spending the layout fixture's AP/ammo.
 * Confirmed requests use rejection probes or successful replay snapshots;
 * session reads and the real server-owned setup remain untouched. */
export async function assertTargetConfirmation(page: Page, selector: string, kind: 'solo' | 'pvp' | 'tower', playerName: string) {
    await page.setViewportSize({ width: 1440, height: 900 });
    const root = page.locator(selector);
    const self = kind === 'tower'
        ? root.locator(`button.tower-board-actor[aria-label^="${playerName},"]`)
        : root.locator('button.hex-tile.hex-player');
    const enemy = kind === 'tower'
        ? root.locator('button.tower-board-actor').filter({ has: page.locator('[data-battlefield-actor="enemy"]') }).first()
        : root.locator('button.hex-tile.hex-enemy').first();
    const endpoint = kind === 'solo' ? '**/api/solo-pve/action' : kind === 'pvp' ? '**/api/pvp/move' : '**/api/towers/action';
    const requests: Array<Record<string, unknown>> = [];
    let responseGate: Promise<void> | undefined;
    const rejection = { status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Target confirmation probe', reason: 'Target confirmation probe', applied: false }) };
    await page.route(endpoint, async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const action = body.action ?? body.type;
        if (action === 'join') return route.fallback();
        // Slow viewport sweeps can outlast Solo's local countdown. Keep its
        // automatic pass outside the probe and preserve the fixture's turn/AP.
        if (action === 'wait') return route.fulfill(rejection);
        requests.push(body);
        await responseGate; // Keep the request pending until the entire pointer/key sequence finishes.
        if (kind === 'pvp') {
            // A successful acknowledgement while it remains our turn must
            // disarm the command too, even without a turn-change reset.
            const snapshot = await page.request.get(`/api/pvp/session?id=${encodeURIComponent(String(body.battleId))}`);
            expect(snapshot.ok()).toBe(true);
            await route.fulfill({ status: 200, contentType: 'application/json', body: await snapshot.text() });
            return;
        }
        if (kind === 'solo') {
            // A rejected action is a successful transport response with the
            // unchanged authoritative session. HTTP 400 instead tests the
            // adapter's network retry, which intentionally repeats its token.
            const snapshot = await page.request.get(`/api/solo-pve/state?sessionId=${encodeURIComponent(String(body.sessionId))}&playerName=${encodeURIComponent(playerName)}`, {
                headers: Object.fromEntries(Object.entries(route.request().headers()).filter(([name]) => name.startsWith('x-') || name === 'authorization')),
            });
            expect(snapshot.ok()).toBe(true);
            await route.fulfill({ json: { ...await snapshot.json(), applied: false, reason: 'Target confirmation probe' } });
            return;
        }
        await route.fulfill(rejection);
    });

    const cases: Array<{ button: Locator; self: boolean; type: string; hotkey?: string; target?: Locator }> = [
        { button: root.locator('.shinobi-command-bar').getByRole('button', { name: /^Heal\b/i }), self: true, type: kind === 'tower' ? 'heal' : 'basicHeal', hotkey: kind === 'pvp' ? 'h' : undefined },
        { button: root.locator('.shinobi-command-bar').getByRole('button', { name: /^Cleanse\b/i }), self: true, type: 'cleanse', hotkey: kind === 'pvp' ? 'x' : undefined },
        { button: root.locator('.shinobi-command-bar').getByRole('button', { name: /^Attack\b/i }), self: false, type: kind === 'tower' ? 'attack' : 'basicAttack' },
        { button: root.locator('.shinobi-command-bar').getByRole('button', { name: /^Clear\b/i }), self: false, type: 'clear', hotkey: kind === 'pvp' ? 'c' : undefined },
    ];
    const summon = root.locator('.shinobi-command-bar').getByRole('button', { name: /^Summon\b/i });
    if (await summon.count()) cases.push({ button: summon, self: true, type: 'summon' });
    const disrupt = root.locator('.tower-disrupt-control');
    if (await disrupt.count()) cases.push({ button: disrupt, self: false, type: 'disrupt', target: root.getByRole('button', { name: /Disrupt pylon here/ }) });
    const item = root.locator('.combat-consumable-card button.combat-item-button:enabled').first();
    if (await item.count()) cases.push({ button: item, self: true, type: 'item' });
    await expect(cases[0]!.button, 'fresh fixture must be able to arm Heal').toBeEnabled();
    await expect(cases[1]!.button, 'fresh fixture must be able to arm Cleanse').toBeEnabled();

    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const subject of cases) {
        if (await subject.button.isDisabled()) continue; // Preserve existing range/cooldown gates.
        const before = requests.length;
        await subject.button.click();
        await expect(subject.button).toHaveAttribute('aria-pressed', 'true');
        await page.waitForTimeout(100);
        expect(requests.length, `${kind} ${subject.type}: arming must not submit`).toBe(before);
        await subject.button.click();
        await expect(subject.button).toHaveAttribute('aria-pressed', 'false');
        expect(requests.length, `${kind} ${subject.type}: cancelling must not submit`).toBe(before);
        if (subject.hotkey) await page.keyboard.press(subject.hotkey);
        else await subject.button.click();
        await expect(subject.button).toHaveAttribute('aria-pressed', 'true');
        const wrongTarget = subject.type === 'disrupt'
            ? root.locator('button.tower-hex-tile:not([data-range])').first()
            : subject.self ? enemy : self;
        await wrongTarget.dispatchEvent('click');
        await page.waitForTimeout(100);
        expect(requests.length, `${kind} ${subject.type}: wrong target must not submit`).toBe(before);
        const target = subject.target ?? (subject.self ? self : enemy);
        const reachable = kind === 'tower'
            ? await target.getAttribute('aria-disabled') !== 'true'
            : subject.self || (await target.getAttribute('class') ?? '').includes('jutsu-target-tile');
        if (reachable) {
            let releaseResponse: (() => void) | undefined;
            responseGate = new Promise<void>(resolve => { releaseResponse = resolve; });
            try {
                if (kind === 'pvp' && subject.type === 'basicHeal') {
                    await target.focus();
                    await page.keyboard.press('Space');
                } else await target.dblclick();
                await expect.poll(() => requests.length, { message: `${kind} ${subject.type}: valid target submits once` }).toBe(before + 1);
            } finally {
                releaseResponse?.();
                responseGate = undefined;
            }
            expect(requests.at(-1)!.action ?? requests.at(-1)!.type).toBe(subject.type);
            if (subject.type === 'item') expect(requests.at(-1)!.itemId).toBeTruthy();
            if (subject.type === 'disrupt') expect(Number.isInteger(requests.at(-1)!.tile)).toBe(true);
            await expect(subject.button).toBeEnabled();
            if (kind === 'pvp') await expect(subject.button, 'successful use must require a fresh selection').toHaveAttribute('aria-pressed', 'false');
        }
        await page.keyboard.press('Escape');
        await expect(subject.button).toHaveAttribute('aria-pressed', 'false');
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.unroute(endpoint);
}

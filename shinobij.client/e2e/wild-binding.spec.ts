import { expect, test, type Page, type TestInfo } from '@playwright/test';

// This spec inspects the seal animation itself, so keep its full motion timing.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const petView = (id: string, name: string, templateId: string) => ({
    id, name, templateId, element: 'Fire', role: 'tracker', rarity: 'standard',
    level: 1, hp: 365, maxHp: 365, stamina: 80, maxStamina: 80,
    meter: 0, ko: false, guarding: false, benched: false, speed: 30,
    skipsNextAction: false, canSwitchOut: true, statuses: [], readiness: 0,
    moves: [
        { name: 'Swift Strike', power: 45, kind: 'damage', cost: 12, signature: false,
            effect: 'A swift basic strike', priority: 1, hold: 0, element: 'None', cls: 'physical' },
        { name: 'Flame Claw', power: 75, kind: 'damage', cost: 24, signature: false,
            effect: 'A heated claw strike', priority: 1, hold: 0, element: 'Fire', cls: 'physical' },
        { name: 'Foxfire', power: 110, kind: 'damage', cost: 0, signature: true,
            effect: 'Full meter signature', priority: 1, hold: 0, element: 'Fire', cls: 'special' },
    ],
});

const state = {
    sessionId: 'wildbindingqatoken001', format: '1v1', tier: 'scrapper', round: 0,
    attritionAt: 12, turnCap: 20, finished: false, outcome: null,
    player: [petView('owned-fox-001', 'Guild Fox', 'standard-0')],
    enemy: [petView('standard-1-17500000', 'Moonfang', 'standard-1')],
    enemyTeamName: 'Moonfang',
};

const seals = [
    ['beast-seal-worn', 'Worn Beast Seal', 20, 0, 0, false],
    ['beast-seal-reinforced', 'Reinforced Beast Seal', 35, 8, 1, true],
    ['beast-seal-tempered', 'Tempered Beast Seal', 50, 16, 0, false],
    ['beast-seal-master', 'Master Beast Seal', 65, 25, 0, false],
    ['beast-seal-ancient', 'Ancient Beast Seal', 80, 30, 0, false],
].map(([id, name, resolveThreshold, captureBonus, count, available]) =>
    ({ id, name, resolveThreshold, captureBonus, count, available, opportunity: 'Excellent opportunity' }));
const wild = {
    name: 'Moonfang', rarity: 'standard', hpPercent: 100, resolvePercent: 35,
    trait: 'Loyal', traitHint: 'Calms quickly when you Rest; Guard also earns its trust.',
    tutorial: true, seals,
};

async function boot(page: Page, succeeds = true) {
    await page.route('**/api/pet/wild-binding', async (route) => {
        const body = route.request().postDataJSON() as { action: string };
        const captured = body.action === 'capture';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
            ok: true, state, wild: captured ? {
                ...wild, tutorial: succeeds, seals: seals.map((seal) => seal.id === 'beast-seal-reinforced'
                    ? { ...seal, count: 0, available: false } : seal),
            } : { ...wild, tutorial: succeeds },
            ...(captured ? {
                capture: { success: succeeds, chance: succeeds ? 100 : 38, sealId: 'beast-seal-reinforced',
                    replayed: false, destination: succeeds ? 'roster' : null,
                    pet: succeeds ? { id: 'standard-1-17500000', name: 'Moonfang', trait: 'Loyal' } : null },
                character: { name: 'BindingQA', pets: [], itemStacks: [] }, _saveVersion: 2,
            } : {}),
        }) });
    });
    await page.goto('/e2e/fixtures/wild-binding.html');
    await expect(page.getByRole('heading', { name: 'Moonfang' })).toBeVisible();
}

test('first binding walkthrough is readable on desktop and mobile', async ({ page }, testInfo: TestInfo) => {
        await boot(page);
        await expect(page.getByText(/Calms quickly when you Rest/)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('encounter-intro.png'), fullPage: true });
        await page.getByRole('button', { name: 'Face the wild pet' }).click();
        await expect(page.getByText(/Calms quickly when you Rest/)).toBeVisible();
        await expect(page.getByText('FIRST ENCOUNTER')).toBeVisible();
        await expect(page.locator('#wild-resolve-meter')).toBeVisible();
        await expect(page.getByRole('button', { name: /Reinforced/i }).first()).toBeVisible();
        await expect(page.locator('.showdown-vs-intro')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath('battle-tutorial.png') });
        await page.getByRole('button', { name: 'Continue' }).first().click();
        await page.getByRole('button', { name: 'Continue' }).first().click();
        const bindButton = page.getByRole('button', { name: /Bind with Reinforced Beast Seal/ });
        await expect(bindButton).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath('seal-ready.png') });
        await bindButton.click();
        await expect(page.getByTestId('pet-showdown-root')).toHaveAttribute('data-wild-binding', 'active');
        await expect(page.getByTestId('pet-showdown-root')).toHaveAttribute('inert', '');
        await expect(page.locator('.wild-binding-overlay.has-arena-cinematic')).toBeVisible();
        const captureScene = page.locator('.wild-binding-overlay.is-binding .wild-binding-capture-scene');
        await expect(captureScene.locator('.wild-binding-capture-pet img')).toBeVisible();
        await expect(captureScene.locator('.wild-binding-capture-pet img')).toHaveAttribute('src', '/pet-portraits/standard-1-card-v2.webp');
        await expect(captureScene.locator('.wild-binding-magic-ring img')).toBeVisible();
        await page.waitForTimeout(550);
        await page.screenshot({ path: testInfo.outputPath('pet-entering-seal.png') });
        await page.waitForTimeout(1450);
        await page.screenshot({ path: testInfo.outputPath('pet-drawn-to-seal.png') });
        await page.waitForTimeout(950);
        await page.screenshot({ path: testInfo.outputPath('seal-impact.png') });
        await expect(page.getByRole('heading', { name: 'Bond formed' })).toBeVisible();
        await expect(page.getByTestId('pet-showdown-root')).not.toHaveAttribute('data-wild-binding', 'active');
        await expect(page.getByTestId('pet-showdown-root')).toHaveAttribute('inert', '');
        await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
        await page.screenshot({ path: testInfo.outputPath('binding-success.png') });
        const viewportWidth = page.viewportSize()?.width ?? 0;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        expect(overflow, `binding screen overflows ${viewportWidth}px viewport`).toBe(false);
});

test('a failed seal releases the wild pet and returns to the arena', async ({ page }, testInfo: TestInfo) => {
    await boot(page, false);
    let turnRequests = 0;
    await page.route('**/api/pet/wild-binding', async (route) => {
        if ((route.request().postDataJSON() as { action: string }).action === 'turn') turnRequests++;
        await route.fallback();
    });
    await page.getByRole('button', { name: 'Face the wild pet' }).click();
    await page.getByRole('button', { name: /Bind · 35% Resolve/ }).click();
    const bindButton = page.getByRole('button', { name: /Bind with Reinforced Beast Seal/ });
    await expect(bindButton).toBeDisabled();
    await expect(page.locator('.showdown-vs-intro')).toHaveCount(0);
    await expect(bindButton).toBeEnabled();
    await bindButton.click();
    await expect(page.getByTestId('pet-showdown-root')).toHaveAttribute('inert', '');
    await page.keyboard.press('Tab');
    await expect(page.locator('.wild-binding-result')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'The seal fractured' })).toBeVisible();
    expect(turnRequests).toBe(0);
    await expect(page.getByTestId('pet-showdown-root')).not.toHaveAttribute('data-wild-binding', 'active');
    await expect(page.getByRole('button', { name: 'Keep fighting' })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('binding-failed.png') });
    await page.getByRole('button', { name: 'Keep fighting' }).click();
    await expect(page.locator('.wild-binding-result')).toHaveCount(0);
    await expect(page.getByTestId('pet-showdown-root')).not.toHaveAttribute('data-wild-binding', 'active');
    await expect(page.getByTestId('pet-showdown-root')).not.toHaveAttribute('inert', '');
    await page.screenshot({ path: testInfo.outputPath('wild-pet-returned.png') });
});

test('capture retires its effects and repeated encounters release WebGL canvases', async ({ page }, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'chromium-desktop');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error' && /WebGL|context|texture|memory/i.test(message.text())) errors.push(message.text());
    });
    await boot(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const heapSamples: number[] = [];
    const idleTaskSamples: number[] = [];
    const cycles = 5;
    for (let cycle = 0; cycle < cycles; cycle++) {
        await page.getByRole('button', { name: 'Face the wild pet' }).click();
        await expect(page.locator('canvas')).toHaveCount(1);
        await page.locator('canvas').evaluate((canvas) => {
            const audit = window as Window & { __wildBindingContextLosses?: number };
            canvas.addEventListener('webglcontextlost', () => { audit.__wildBindingContextLosses = (audit.__wildBindingContextLosses ?? 0) + 1; }, { once: true });
        });
        await page.getByRole('button', { name: 'Continue' }).first().click();
        await page.getByRole('button', { name: 'Continue' }).first().click();
        await page.getByRole('button', { name: /Bind with Reinforced Beast Seal/ }).click();
        await expect(page.getByRole('heading', { name: 'Bond formed' })).toBeVisible();
        await expect(page.getByTestId('pet-showdown-root')).not.toHaveAttribute('data-wild-binding', 'active');
        await page.evaluate(() => (window as Window & { __wildBindingQa: { unmount(): void } }).__wildBindingQa.unmount());
        await expect(page.locator('canvas')).toHaveCount(0);
        await page.waitForFunction((count) => (window as Window & { __wildBindingContextLosses?: number }).__wildBindingContextLosses === count, cycle + 1);
        await cdp.send('HeapProfiler.collectGarbage');
        const { metrics } = await cdp.send('Performance.getMetrics');
        heapSamples.push(metrics.find((entry) => entry.name === 'JSHeapUsedSize')?.value ?? 0);
        const taskBefore = metrics.find((entry) => entry.name === 'TaskDuration')?.value ?? 0;
        await page.waitForTimeout(500);
        const afterIdle = await cdp.send('Performance.getMetrics');
        const taskAfter = afterIdle.metrics.find((entry) => entry.name === 'TaskDuration')?.value ?? taskBefore;
        idleTaskSamples.push(Math.round((taskAfter - taskBefore) * 1000));
        if (cycle < cycles - 1) await page.evaluate(() => (window as Window & { __wildBindingQa: { mount(): void } }).__wildBindingQa.mount());
    }
    expect(errors).toEqual([]);
    // A cache may retain decoded models, so this is diagnostic evidence rather
    // than a brittle fixed-byte threshold for the browser's heap allocator.
    console.log(`wild binding heap after GC (${cycles} cycles): ${heapSamples.map((bytes) => (bytes / 1048576).toFixed(1)).join(', ')} MiB`);
    console.log(`wild binding idle main-thread task time per 500 ms after unmount: ${idleTaskSamples.join(', ')} ms`);
});

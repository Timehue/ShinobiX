import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
const reports = [];
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('pet-music-muted', '1');
        localStorage.setItem('vnAutoRead.v1', '0');
    });
    const calls = [];
    // Never allow a preview to create a real encounter or write account data.
    await context.route('**/api/**', route => {
        calls.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'QA intercepted encounter start' }) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(120000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    async function open(seal, line = 0, custom = false) {
        const query = '?' + new URLSearchParams({ preview: 'vn', reader: 'dungeon', event: 'builtin-hidden-dungeon', page: String(seal), line: String(line), ...(custom ? { dungeonArt: '1' } : {}) });
        if (!page.url().startsWith('http')) await page.goto('http://127.0.0.1:4173/' + query, { waitUntil: 'domcontentloaded' });
        else await page.evaluate(query => { history.pushState({}, '', query); dispatchEvent(new PopStateEvent('popstate')); }, query);
        await page.waitForFunction(query => document.querySelector('[data-vn-preview-route]')?.getAttribute('data-vn-preview-route') === query, query);
        await page.locator('.cvn-root').waitFor({ timeout: 90000 });
        await page.locator('.cvn-dialogue-footer button').first().waitFor();
    }
    const text = () => page.locator('.cvn-dialogue-text').textContent();
    await open(0);
    const first = await text();
    // Same-burst input may advance only once.
    await page.getByRole('button', { name: 'Next', exact: true }).evaluate(button => { button.click(); button.click(); });
    await page.waitForFunction(() => document.querySelector('.cvn-dialogue-text').textContent.includes('first seal is mine'));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.waitForFunction(first => document.querySelector('.cvn-dialogue-text').textContent === first, first);
    reports.push('Back and same-burst Next preserve line order');

    await open(0, 2);
    assert.equal((await text()).trim(), 'Once?');
    assert.equal(await page.locator('.cvn-actor:not(.is-player) img').count(), 1, 'Warden remains present on player replies');
    assert.equal(await page.locator('.cvn-actor.is-player').count(), 0, 'No initials card without an avatar');
    reports.push('Player replies retain the Warden and omit empty avatar cards');

    await open(0, 3);
    await page.getByRole('button', { name: 'Challenge Seal One', exact: true }).click();
    await page.getByText('Preview paused: warden fight', { exact: true }).waitFor();
    reports.push('Explicit Warden action hands off to existing combat');

    for (const seal of [1, 2]) {
        await open(seal);
        await page.getByRole('button', { name: 'Next', exact: true }).click();
        const action = seal === 1 ? 'Start Chronicle Seal' : 'Challenge Rare Pet';
        await page.getByRole('button', { name: action, exact: true }).waitFor();
        assert.ok((await text()).includes(seal === 1 ? 'Set a legal' : 'Win together'), 'Final dialogue is readable before battle');
        assert.equal(calls.filter(url => url === '/api/card-clash/ai-start').length, 0, 'No encounter starts from Next');
        await page.locator('.cvn-root').focus();
        await page.keyboard.press('Space');
        await page.locator('.cvn-root').waitFor();
        if (seal === 1) await Promise.all([
            page.waitForResponse(response => response.url().endsWith('/api/card-clash/ai-start')),
            page.getByRole('button', { name: action, exact: true }).click(),
        ]);
        else await page.getByRole('button', { name: action, exact: true }).click();
        await page.locator('.cvn-root').waitFor({ state: 'detached' });
        reports.push(`Seal ${seal + 1} final line requires an explicit challenge`);
        calls.length = 0;
    }

    for (const seal of [0, 1, 2]) {
        await open(seal, 0, true);
        await page.waitForFunction(() => [...document.querySelectorAll('.cvn-root img')].every(i => i.complete && i.naturalWidth));
        const background = await page.locator('.cvn-backdrop').evaluate(el => getComputedStyle(el).backgroundImage);
        const expected = seal === 0 ? 'craft-dungeon-forest.webp' : seal === 1 ? 'craft-dungeon-central.webp' : 'dungeon-companion-chamber-v1.webp';
        assert.ok(background.includes(expected), 'Dedicated art stays attached to the correct seal');
        assert.equal(await page.locator('.cvn-actor.is-player img').count(), 1, 'Shared-store avatar wins over empty character image');
        assert.ok((await page.locator('.cvn-actor:not(.is-player) img').getAttribute('src')).endsWith('?custom=1'));
        reports.push(`Seal ${seal + 1} preserves dedicated art and shared avatar`);
    }
    await page.getByRole('button', { name: 'Leave', exact: true }).click();
    await page.getByText('Preview paused: dungeon exit', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    reports.push('Leave exits the dungeon without advancing a seal');
} finally {
    await browser.close();
    await writeFile('../tmp/vn-reader-pass/flow-report.json', JSON.stringify(reports, null, 2));
}
console.log(reports.join('\n'));

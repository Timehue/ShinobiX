import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createMatch, projectMatchForViewer, migrateLegacyDeck } from '../../shared/chronicle-duel';

const output = '../tmp/vn-wiring-pass';
await mkdir(output, { recursive: true });
const inventory = JSON.parse(await readFile('../tmp/vn-reader-pass/inventory.json', 'utf8'));
const checks: string[] = [], errors: string[] = [], requests: string[] = [];
const browser = await chromium.launch({ headless: true });
try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(120000);
    const deck = migrateLegacyDeck([], [], true).deck;
    const match = createMatch('QA Shinobi', deck, 'Chronicle Keeper', deck, () => .2, 1);
    match.status = 'complete'; match.winner = 'p1';
    const proof = { token: 'art-preview', startedAt: 0, combatAuthorityVersion: 1, wardenDefeated: true, wardenProofId: 'previewwarden',
        cardAuthorityVersion: 1, cardDefeated: true, cardLastOutcome: 'player', cardSettledAt: 1, cardDefeatedAt: 1, cardProofId: 'previewcards', cardLastProofId: 'previewcards' };
    const pet = { id: 'qa-pet', name: 'QA Wolf', rarity: 'standard', level: 10, xp: 0, maxLevel: 100,
        hp: 100, attack: 20, defense: 10, speed: 15, jutsus: [], unlockedForPve: true, happiness: 100 };
    // Keep the real Dungeon host, authority adapter and result callbacks. Replace
    // only the 3D renderer so this check can control when its animation finishes.
    await context.route('**/src/components/PetColiseum.tsx*', async route => {
        const source = await (await route.fetch()).text();
        const reactModule = source.match(/from\s+["']([^"']*\/react\.js[^"']*)["']/)?.[1];
        assert.ok(reactModule, 'Vite must expose the renderer React dependency');
        await route.fulfill({ contentType: 'application/javascript', body: `
            import React from ${JSON.stringify(reactModule)};
            export function PetColiseumDuel(props) {
                return React.createElement('section', null,
                    React.createElement('h2', null, 'Pet result fixture'),
                    React.createElement('p', {'data-testid': 'pet-settlement'}, props.settlementStatus),
                    React.createElement('button', {onClick: () => props.onOutcome({result: 'win'})}, 'Finish fixture battle'),
                    React.createElement('button', {onClick: props.onExit}, 'Return to Dungeon'));
            }` });
    });
    await context.route('**/api/**', async route => {
        const pathname = new URL(route.request().url()).pathname;
        requests.push(pathname);
        const body = pathname === '/api/card-clash/ai-start' ? {
            ok: true, matchId: 'qacards12345', _saveVersion: 5,
            character: { name: 'QA Shinobi', pets: [pet], activePetId: pet.id, activeDungeonRun: proof },
            session: { ...projectMatchForViewer(match, 'p1'), matchId: 'qacards12345', aiDifficulty: 'medium', aiDeckName: 'QA Keeper' },
        } : pathname === '/api/pet/battle-start' ? {
            dungeon: true, token: 'qapet12345678', reportKey: '7319:casual', seed: 7319,
            playerPets: [pet], opponentPets: [{ ...pet, id: 'dungeon-rare-beast', name: 'Sealed Beast' }],
            battleConfig: { mode: '1v1', seed: 7319, damageMult: 1, hpMult: 1, revive: false, applyItems: true, accuracy: true, terrain: null },
        } : pathname === '/api/pet/battle-result' ? {
            dungeon: true, outcome: 'win', _saveVersion: 6,
            character: { name: 'QA Shinobi', pets: [pet], activePetId: pet.id, activeDungeonRun: {
                ...proof, petAuthorityVersion: 1, petDefeated: true, petLastOutcome: 'win', petSettledAt: 1,
                petDefeatedAt: 1, petProofId: 'qapet12345678', petLastProofId: 'qapet12345678', petLastPetIds: [pet.id],
            } },
        } : { ok: false, error: 'No live API calls from the wiring preview' };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    async function open(params: Record<string, string>) {
        const query = '?' + new URLSearchParams({ preview: 'vn', ...params });
        if (!page.url().startsWith('http')) await page.goto('http://127.0.0.1:4173/' + query, { waitUntil: 'domcontentloaded' });
        else await page.evaluate(query => { history.pushState({}, '', query); dispatchEvent(new PopStateEvent('popstate')); }, query);
        await page.waitForFunction(query => document.querySelector('[data-vn-preview-route]')?.getAttribute('data-vn-preview-route') === query, query);
        await page.locator('.cvn-root').waitFor({ timeout: 90000 });
        await page.locator('.cvn-dialogue-footer button').first().waitFor();
    }
    async function advance(label: string) {
        const before = await page.locator('.cvn-dialogue-text').textContent();
        await page.getByRole('button', { name: label, exact: true }).click();
        await page.waitForFunction(before => document.querySelector('.cvn-dialogue-text')?.textContent !== before, before);
    }
    const row = inventory.rows.find((r: { pageIndex: number; key: string; presentations: unknown[] }) => r.pageIndex === 0 && !r.key.includes('archive') && r.presentations.length >= 4);
    await open({ event: row.eventId });
    const firstLine = await page.locator('.cvn-dialogue-text').textContent();
    await advance('Next'); await advance('Next');
    await advance('Back'); await advance('Back');
    assert.equal(await page.locator('.cvn-dialogue-text').textContent(), firstLine);
    assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    const saved = JSON.parse((await page.getByTestId('vn-qa-save').textContent())!);
    assert.equal(saved.scene.lineIndex, 0); assert.equal(saved.scene.history.length, 0);
    await page.getByRole('button', { name: 'Resume preview', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true);
    checks.push('Repeated Back consumes history and serialized resume does not restore discarded entries');

    const chest = inventory.rows.find((r: { eventId: string; pageIndex: number }) => r.eventId === 'sys-ancient-chest' && r.pageIndex === 0);
    await open({ event: 'sys-ancient-chest' });
    for (let i = 0; i < chest.presentations.length; i++) await advance('Next');
    await advance('Back'); await advance('Back');
    assert.match(await page.locator('.cvn-progress').getAttribute('aria-label') || '',
        new RegExp(`Page 1 of .*line ${chest.presentations.length - 1} of`));
    for (let i = 0; i < chest.presentations.length - 2; i++) await advance('Back');
    assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true);
    checks.push('Back crosses page boundaries without getting stuck');

    await open({ event: 'builtin-hidden-dungeon', reader: 'dungeon', page: '1', line: '1' });
    await page.getByRole('button', { name: 'Start Chronicle Seal', exact: true }).click();
    await page.getByRole('heading', { name: 'Seal Claimed', exact: true }).waitFor();
    assert.equal(await page.locator('.cvn-root').count(), 0, 'proof update must retain the battle result');
    await page.screenshot({ path: `${output}/card-result-before-continue.png` });
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.cvn-root').waitFor();
    await page.waitForFunction(() => document.querySelector('.cvn-dialogue-text')?.textContent.includes('The last seal belongs to your companion'));
    assert.match(await page.locator('.cvn-progress').getAttribute('aria-label') || '', /Seal 3 of 3, line 1 of 2/);
    await page.screenshot({ path: `${output}/next-seal-first-line.png` });
    assert.equal(requests.filter(url => url === '/api/card-clash/ai-start').length, 1);
    checks.push('Real Chronicle result stays mounted after proof adoption and Continue starts the next seal at line one');

    await advance('Next');
    await page.getByRole('button', { name: 'Challenge Rare Pet', exact: true }).click();
    await page.getByRole('button', { name: 'Start Pet Battle', exact: true }).click();
    await page.getByRole('button', { name: 'Finish fixture battle', exact: true }).click();
    await page.getByTestId('pet-settlement').filter({ hasText: 'settled' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Claim Dungeon Reward', exact: true }).count(), 0,
        'pet proof must not unmount its result renderer');
    await page.screenshot({ path: `${output}/pet-result-before-exit.png` });
    await page.getByRole('button', { name: 'Return to Dungeon', exact: true }).click();
    await page.getByRole('button', { name: 'Claim Dungeon Reward', exact: true }).waitFor();
    assert.equal(requests.filter(url => url === '/api/pet/battle-result').length, 1);
    checks.push('Rare Beast authority proof retains the result host until exit, then exposes reward claim (3D renderer stubbed)');

    await open({ event: row.eventId });
    await page.getByRole('button', { name: 'Visual novel settings' }).click();
    await page.getByRole('button', { name: 'Classic reader', exact: true }).click();
    await page.locator('.vn-stage').waitFor();
    await advanceClassic('Next'); await advanceClassic('Next');
    await advanceClassic('Back'); await advanceClassic('Back');
    assert.equal(await page.getByRole('button', { name: 'Back', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cinematic', exact: true }).click();
    await page.locator('.cvn-root').waitFor();
    assert.equal(await page.locator('.cvn-dialogue-text').textContent(), firstLine);
    checks.push('Classic and cinematic preserve the same corrected history and cursor');
    async function advanceClassic(label: string) {
        const before = await page.locator('.vn-dialogue > p').textContent();
        await page.getByRole('button', { name: label, exact: true }).click();
        await page.waitForFunction(before => document.querySelector('.vn-dialogue > p')?.textContent !== before, before);
    }
    assert.deepEqual(errors, []);
    console.log(checks.join('\n'));
} finally {
    await browser.close();
    await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors, interceptedRequests: requests }, null, 2));
}

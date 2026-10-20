import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSoloPveAiEncounter } from '../../api/solo-pve/_ai-encounter.js';
import { storyBossEnemyTemplate } from '../../api/story/_authoritative-story-combat.js';
import { NARRATIVE_ENEMY_IDENTITIES } from '../../shared/narrative-enemy-identity.js';
import { builtinAiProfile } from '../../api/_ai-profile-catalog.js';
import { academySparEnemyTemplate } from '../../api/story/_academy-spar.js';

// Start the existing local-only combat-grid QA Vite configuration first.
const baseURL = process.env.NARRATIVE_QA_URL ?? 'http://127.0.0.1:15213';
const output = resolve('shinobij.client/test-results/narrative-enemy-identity');
await mkdir(output, { recursive: true });
const save = { character: { name: 'Rill', level: 75, hp: 2000, maxHp: 2000, stats: {} } };
const profiles: Array<Record<string, unknown> & {id:string}> = [
    // The real tutorial host supplies this same portrait as a display override.
    { ...academySparEnemyTemplate(), avatarImage: '/portraits/academy-training-dummy.webp' },
    ...[['Stormveil Village', 6], ['Ashen Leaf Village', 0], ['Frostfang Village', 0], ['Stormveil Village', 4], ['Frostfang Village', 4],
        ['Ashen Leaf Village', 3], ['Frostfang Village', 2], ['Moonshadow Village', 3], ['Moonshadow Village', 4]]
        .map(([village, progressIndex]) => storyBossEnemyTemplate({ village: String(village), progressIndex: Number(progressIndex) })),
    ...Object.keys(NARRATIVE_ENEMY_IDENTITIES).filter(id => id.startsWith('rift-boss-') || ['road-ai-foreman-dray', 'sunscar-scorpion', 'ashbound-slag'].includes(id))
        .map(id => ({ id: id === 'ashbound-slag' ? `world-questbook-qb-ashes-${id}` : id,
            name: builtinAiProfile(id)?.name ?? (id === 'sunscar-scorpion' ? 'Scorpion Queen' : 'Slag'), level: 75 })),
];
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    const filter = process.env.NARRATIVE_QA_FILTER;
    for (const profile of profiles.filter(entry => !filter || new RegExp(filter).test(entry.id))) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const sealed = buildSoloPveAiEncounter({ profile, save, sessionId: 'narrative-qa', playerName: 'rill', admin: null, now: Date.now() });
        const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.addInitScript(session => {
            const target = window as unknown as { __NARRATIVE_QA_ENEMY__: unknown; __NARRATIVE_QA_SESSION__: unknown };
            target.__NARRATIVE_QA_ENEMY__ = session.enemy; target.__NARRATIVE_QA_SESSION__ = session;
        }, sealed);
        const gate = profile.id.startsWith('rift-boss-');
        await page.goto(`${baseURL}/combat-grid-qa.html?narrative-identity&biome=forest${gate ? '&gate-boss' : ''}`, { waitUntil: 'domcontentloaded' });
        const actor = page.locator('[data-battlefield-actor-id="enemy"]');
        const mirror = profile.id === 'story-ai-moonshadow-village-50';
        await expect(actor).toHaveAttribute('data-battlefield-presentation', mirror ? 'marker' : 'sprite');
        const sprite = actor.locator(mirror ? 'img.battlefield-actor-portrait-image' : 'img.battlefield-actor-sprite');
        await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
        const src = await sprite.getAttribute('src');
        expect(src).not.toContain('ai-rival-fallback');
        expect(src).not.toContain('hollow-hound');
        const portrait = mirror ? await page.locator('[data-battlefield-actor-id="player"] img.battlefield-actor-portrait-image').getAttribute('src') : sealed.enemy.character.avatarImage;
        if (mirror) expect(src, 'the Mirror copies the player on the board').toBe(portrait);
        expect(typeof portrait).toBe('string');
        await expect.poll(() => page.locator('img').evaluateAll((images, src) => images.some(image => image.getAttribute('src') === src && !image.classList.contains('battlefield-actor-sprite')), portrait)).toBe(true);
        if (gate) {
            await expect(page.getByText('The shrine wards gather power', { exact: true })).toBeVisible();
            await expect(page.getByText(/The Alpha tests/)).toHaveCount(0);
        }
        const loaded = await page.evaluate(src => new Promise<boolean>(resolve => {
            const image = new Image(); image.onload = () => resolve(image.naturalWidth > 0); image.onerror = () => resolve(false); image.src = String(src);
        }), portrait);
        expect(loaded).toBe(true);
        const file = `${profile.id}-${viewport.width}.png`;
        await page.screenshot({ path: resolve(output, file), fullPage: true });
        results.push({ id: profile.id, viewport: viewport.width, sprite: src, portrait, screenshot: file });
        await context.close();
    }
    await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`Verified ${results.length} desktop/mobile combat appearances.`);
} finally { await browser.close(); }

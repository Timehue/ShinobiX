import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { legacyVnFixture } from './vn-art-fixtures.mjs';

const output = path.resolve('../tmp/vn-avatar-refresh');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
    for (const viewport of [{ width: 2513, height: 1201 }, { width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        for (const scene of ['avatar', 'legacy-narrator', 'legacy-harrow', 'wide-avatar', 'tall-avatar']) {
            const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => {
                localStorage.setItem('vnTextSpeed.v1', 'instant');
                localStorage.setItem('pet-music-muted', '1');
            });
            await page.route('**/api/img?**', async route => {
                const id = new URL(route.request().url()).searchParams.get('id');
                const slot = id?.split(':page:')[1];
                if (!slot || !id.includes('story-frostfang-village-85-7')) return route.continue();
                const body = await legacyVnFixture(id);
                await route.fulfill({ contentType: 'image/webp', body });
            });
            const legacy = scene.startsWith('legacy');
            const params = new URLSearchParams({ preview: 'vn', event: legacy ? 'story-frostfang-village-85-7' : 'story-interlude-frostfang-village-80',
                page: scene === 'legacy-narrator' ? '0' : '1', line: '0', legacyArt: legacy ? '1' : '0',
                avatar: scene === 'wide-avatar' ? 'wide' : 'square',
                ...(scene !== 'wide-avatar' ? { avatarSource: scene === 'tall-avatar' ? '/portraits/cinematic/toma-reed.webp' : '/starter-avatar-one.webp' } : {}),
            });
            await page.goto(`http://127.0.0.1:4173/?${params}`, { waitUntil: 'domcontentloaded' });
            await page.locator('.cvn-root').waitFor({ timeout: 90000 });
            if (legacy) await page.waitForFunction(() => !document.querySelector('.cvn-root img[src*="/api/img"]')
                && !getComputedStyle(document.querySelector('.cvn-backdrop')).backgroundImage.includes('/api/img'));
            await page.waitForFunction(() => [...document.querySelectorAll('.cvn-root img')].every(i => i.complete && i.naturalWidth));
            await page.evaluate(async () => {
                const image = new Image();
                image.src = getComputedStyle(document.querySelector('.cvn-backdrop')).backgroundImage.match(/url\(["']?(.*?)["']?\)/)[1];
                await image.decode();
            });
            const metrics = await page.evaluate(() => ({
                overflow: document.documentElement.scrollWidth - innerWidth,
                background: getComputedStyle(document.querySelector('.cvn-backdrop')).backgroundImage,
                dialogue: document.querySelector('.cvn-dialogue-shell').getBoundingClientRect().toJSON(),
                actors: [...document.querySelectorAll('.cvn-actor')].map(a => ({ name: a.textContent, rect: a.getBoundingClientRect().toJSON() })),
                avatar: document.querySelector('.is-player img')?.getBoundingClientRect().toJSON(),
            }));
            assert.equal(errors.length, 0, errors.join('\n'));
            assert.ok(metrics.overflow <= 1, 'No horizontal overflow');
            if (scene === 'legacy-narrator') {
                assert.equal(metrics.actors.length, 0, 'Narration has no inherited elder or player portrait');
                assert.match(metrics.background, /white-silence-dawn-v1/);
            }
            if (scene === 'legacy-harrow') assert.match(metrics.background, /forger-icehouse-v1/);
            if (scene === 'avatar') {
                assert.ok(metrics.avatar.width >= (viewport.width > 800 && viewport.height > 680 ? 390 : 120), 'Avatar fills a readable portion of the stage');
                assert.ok(metrics.avatar.bottom <= metrics.dialogue.top, 'Profile stays above dialogue');
                assert.ok(metrics.avatar.x >= 0 && metrics.avatar.right <= viewport.width, 'Profile stays on screen');
            }
            const name = `${scene}-${viewport.width}`;
            await page.screenshot({ path: path.join(output, `${name}.png`) });
            report.push({ name, ...metrics, errors });
            console.log(name);
            await page.close();
        }
    }
    if (process.argv.includes('--live-proof')) {
        const page = await browser.newPage();
        await page.goto('https://shinobijourney.com', { waitUntil: 'domcontentloaded' });
        const live = await page.evaluate(async () => {
            const source = '/api/img?id=vn%3Astory-frostfang-village-85-7%3Apage%3A0';
            const response = await fetch(source, { credentials: 'same-origin' });
            const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
            return { url: response.url, hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') };
        });
        assert.equal(live.hash, '6b9ea4b847a98c42a5a1b980b014011c2a57e57fcd24fe0f2d8cb67a9b406eae');
        report.push({ name: 'live-cdn-fingerprint', ...live });
        console.log('live-cdn-fingerprint');
    }
} finally {
    await browser.close();
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}

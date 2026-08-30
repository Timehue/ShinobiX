#!/usr/bin/env node
/*
 * Refresh the README / media-kit screenshots from a running client.
 *
 * docs/MEDIA_KIT.md used to describe this as a manual pass ("captured from
 * local development on July 7, 2026"), and the result was predictable: the
 * README showed a seven-week-old build through an entire visual overhaul while
 * claiming visitors "see real app screens". This makes the refresh one command
 * so the claim can stay true.
 *
 * Usage:
 *   npm run dev --prefix shinobij.client        # in another shell
 *   npm run capture:screenshots --prefix shinobij.client -- http://127.0.0.1:5173
 *
 * Lives under shinobij.client/ because it imports @playwright/test, which is a
 * client devDependency; ESM resolves from the file's own location, not cwd.
 *
 * Captures at 1440x900 (a 16:10 desktop) because the README renders these at
 * roughly half width; smaller sources look soft on HiDPI.
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const baseUrl = (process.argv[2] ?? 'http://127.0.0.1:5173').replace(/\/$/, '');
// Relative to this file, not cwd: playwright resolves from shinobij.client,
// so the script is run from there while writing to the repo's docs/.
const outDir = fileURLToPath(new URL('../../docs/screenshots/', import.meta.url));

const shots = [
    {
        file: 'landing.jpg',
        about: 'the public landing page, hero visible',
        async go(page) {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: /^Enter the World$/i }).waitFor({ timeout: 30_000 });
        },
    },
    {
        file: 'character-creator.jpg',
        about: 'the Academy Gate, first step of character creation',
        async go(page) {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: /^Enter the World$/i }).click();
            await page.getByRole('button', { name: /Choose Village/i }).waitFor({ timeout: 30_000 });
        },
    },
    {
        file: 'village-select.jpg',
        about: 'the four rival villages',
        async go(page) {
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: /^Enter the World$/i }).click();
            await page.getByRole('button', { name: /Choose Village/i }).click();
            await page.getByRole('button', { name: /Choose Bloodline/i }).waitFor({ timeout: 30_000 });
        },
    },
];

/*
 * DELIBERATELY STOPS BEFORE THE ACCOUNT STEP.
 *
 * Creation runs Gate -> Village -> Bloodline -> Avatar -> Preview -> Account,
 * and everything past Preview needs a real account with a password. So the
 * in-game shots (combat, village hub, Pet Yard, the ones MEDIA_KIT lists under
 * "Recommended Next Captures") cannot be produced by this script and still need
 * a human with a throwaway account, as the July 2026 pass did.
 *
 * What this script does cover is the whole pre-account funnel — which is also
 * the part a visitor to the repo sees first.
 */

async function dismissConsent(page) {
    const gotIt = page.getByRole('button', { name: /^Got it$/i });
    if (await gotIt.count()) await gotIt.first().click().catch(() => {});
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await mkdir(outDir, { recursive: true });

let failed = 0;
for (const shot of shots) {
    try {
        await shot.go(page);
        await dismissConsent(page);
        // Let fonts, hero art and any entry transition settle before capturing.
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        const path = outDir + shot.file;
        // JPEG, not PNG. These are dark, mostly-flat UI panels over painted art,
        // which JPEG handles well: the same frames were 0.6-1.1 MB as PNG and are
        // roughly a quarter of that at q92, with no visible softening of the UI
        // text at the size the README renders them.
        await page.screenshot({ path, type: 'jpeg', quality: 92 });
        console.log(`[capture] ${shot.file} — ${shot.about}`);
    } catch (error) {
        failed += 1;
        console.error(`[capture] FAILED ${shot.file}: ${error instanceof Error ? error.message : error}`);
    }
}
await browser.close();
if (failed) {
    console.error(`[capture] ${failed} capture(s) failed; existing files were left untouched.`);
    process.exitCode = 1;
}

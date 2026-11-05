import { expect, test, type Locator } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Exercise the moving scenic fallbacks as well as the static portrait override.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test('field artwork requests only the responsive images needed by its layout', async ({ page }, info) => {
    const mapRequests: string[] = [];
    page.on('request', request => {
        const path = new URL(request.url()).pathname;
        if (path.startsWith('/sector-map/')) mapRequests.push(path);
    });
    await expectUiAuditBoot(page, await installUiAuditRuntime(page), 'missions');
    await page.getByRole('tab', { name: 'Field', exact: true }).click();
    const images = page.locator('.mh-field-art img');
    await expect(images).toHaveCount(5);
    await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
    }))).toBe(true);
    const mobile = await page.evaluate(() => matchMedia('(max-width: 700px)').matches);
    const artwork = await images.evaluateAll(nodes => nodes.map(node => {
        const image = node as HTMLImageElement;
        return { selected: new URL(image.currentSrc).pathname, backdrop: getComputedStyle(image.parentElement!, '::before').backgroundImage };
    }));
    if (mobile) {
        expect(artwork.every(image => image.selected.startsWith('/sector-map/thumbs/'))).toBe(true);
        expect(artwork.every(image => image.backdrop === 'none')).toBe(true);
    } else {
        expect(artwork.every(image => image.backdrop.includes('/sector-map/s'))).toBe(true);
    }
    await page.screenshot({ path: info.outputPath('field-artwork.png'), animations: 'disabled' });
    // CSS downloads count too: img.currentSrc alone missed the full-size
    // backgrounds Chromium fetched despite mobile ::before having content:none.
    expect([...new Set(mapRequests)].sort()).toEqual([...new Set(artwork.map(image => image.selected))].sort());
});

const portraitIds = ['profession:elder-portrait', 'profession:portrait-petTamer', 'profession:portrait-healer', 'profession:portrait-vanguard'];

async function expectUncropped(images: Locator) {
    await expect.poll(() => images.evaluateAll(nodes => nodes.every(node => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth === 600;
    }))).toBe(true);
    const frames = await images.evaluateAll(nodes => nodes.map(node => {
        const image = node as HTMLImageElement, style = getComputedStyle(image);
        const frame = image.parentElement!.getBoundingClientRect(), box = image.getBoundingClientRect();
        const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
        return {
            fit: style.objectFit, transform: style.transform, animation: style.animationName,
            renderedWidth: image.naturalWidth * scale, renderedHeight: image.naturalHeight * scale,
            frameWidth: frame.width, frameHeight: frame.height,
            backdrop: getComputedStyle(image.parentElement!, '::before').backgroundImage,
        };
    }));
    for (const frame of frames) {
        expect(frame.fit).toBe('contain');
        expect(frame.transform).toBe('none');
        expect(frame.animation).toBe('none');
        expect(frame.renderedWidth).toBeLessThanOrEqual(frame.frameWidth + 1);
        expect(frame.renderedHeight).toBeLessThanOrEqual(frame.frameHeight + 1);
        expect(frame.backdrop).toContain('/api/img');
    }
}

for (const shape of ['fallback', '2:3', '3:4'] as const) {
    test(`profession ${shape} art stays readable through intro, choice and confirmation`, async ({ page }, info) => {
        const save = uiAuditSave();
        save.character = { ...save.character, profession: undefined };
        await installUiAuditRuntime(page, save);
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        if (shape !== 'fallback') {
            // Hydrate actual sharedImages props through the image fixture. The
            // marker figure makes face cropping obvious in retained captures.
            await page.route('**/api/images?*', route => route.fulfill({ json: { version: '1', ids: portraitIds } }));
            await page.route('**/api/img?*', route => route.fulfill({ contentType: 'image/svg+xml', body:
                `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${shape === '2:3' ? 900 : 800}"><rect width="600" height="900" fill="#203c59"/><circle cx="300" cy="145" r="90" fill="#cfa67a"/><circle cx="270" cy="140" r="8"/><circle cx="330" cy="140" r="8"/><rect x="150" y="250" width="300" height="400" rx="60" fill="#b16636"/><g fill="white" font-family="sans-serif" font-size="38" text-anchor="middle"><text x="300" y="50">TOP / HEAD</text><text x="300" y="430">TORSO</text><text x="300" y="760">LOWER BODY</text></g></svg>` }));
        }
        await page.goto('/#/missions');
        const elder = page.locator('.pp-elder-art img');
        await expect(elder).toBeVisible();
        if (shape === 'fallback') {
            await expect(elder).toHaveCSS('object-fit', 'cover');
            await expect(elder).toHaveCSS('animation-name', 'pp-kenburns');
        } else await expectUncropped(elder);
        await page.screenshot({ path: info.outputPath(`profession-${shape.replace(':', '-')}-elder.png`), animations: 'disabled' });
        await page.getByRole('button', { name: /Continue/ }).click();
        const choices = page.locator('.pp-card-art > img');
        await expect(choices).toHaveCount(3);
        if (shape === 'fallback') await expect(choices.first()).toHaveCSS('object-fit', 'cover');
        else {
            await expectUncropped(choices);
            await page.getByRole('button', { name: /Walk the Healer/ }).focus();
            await expectUncropped(choices);
            if (!info.project.use.isMobile) {
                await page.locator('.pp-card').first().hover();
                await expectUncropped(choices);
            }
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await expectUncropped(choices);
            await page.emulateMedia({ reducedMotion: 'no-preference' });
        }
        await page.screenshot({ path: info.outputPath(`profession-${shape.replace(':', '-')}-choices.png`), animations: 'disabled' });
        await page.getByRole('button', { name: /Walk the Healer/ }).click();
        const confirmation = page.locator('.pp-confirm-art img');
        await expect(confirmation).toBeVisible();
        if (shape === 'fallback') {
            await expect(confirmation).toHaveCSS('object-fit', 'cover');
            await expect(confirmation).toHaveCSS('animation-name', 'pp-kenburns');
        } else await expectUncropped(confirmation);
        await expect(page.getByRole('button', { name: "Yes, I'm sure" })).toBeInViewport();
        await page.screenshot({ path: info.outputPath(`profession-${shape.replace(':', '-')}-confirm.png`), animations: 'disabled' });
        expect(errors).toEqual([]);
    });
}

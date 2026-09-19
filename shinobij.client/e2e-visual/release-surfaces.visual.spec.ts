import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { PUBLIC_CAPABILITY_IDS } from '../../shared/public-capabilities';
import { LEGAL_PAGE_LINKS } from '../src/data/legal';

const FIXED_NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installDeterministicRuntime(page: Page) {
    await page.addInitScript((fixedNow) => {
        const NativeDate = Date;
        class FixedDate extends NativeDate {
            constructor(...args: [] | ConstructorParameters<typeof Date>) {
                super(args.length === 0 ? fixedNow : args[0]);
            }
            static now() { return fixedNow; }
        }
        globalThis.Date = FixedDate as DateConstructor;
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
    }, FIXED_NOW);
    await page.route('**/api/**', (route) => json(route, {
        ok: true,
        images: {},
        categories: {},
        players: [],
        ladder: [],
        leaderboard: [],
        announcements: [],
        entries: [],
        eras: [],
        wars: [],
        territories: [],
        standings: [],
    }));
}

async function settleVisualState(page: Page) {
    await page.addStyleTag({ content: `
        *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            caret-color: transparent !important;
        }
        html { scroll-behavior: auto !important; }
        canvas, video { visibility: hidden !important; }
    ` });
    await page.evaluate(() => document.fonts.ready);
}

async function screenshot(page: Page, name: string) {
    await settleVisualState(page);
    await expect(page).toHaveScreenshot(name, {
        fullPage: false,
    });
}

async function sectionScreenshot(page: Page, section: Locator, name: string) {
    await section.scrollIntoViewIfNeeded();
    await section.locator('img').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => image instanceof HTMLImageElement ? image.decode().catch(() => undefined) : undefined));
    });
    await expect(section).toHaveScreenshot(name, {
        animations: 'disabled',
        caret: 'hide',
    });
}

async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => installDeterministicRuntime(page));

test('landing atmosphere pauses offscreen and respects reduced motion without a toggle', async ({ page }) => {
    // The removed control's saved preference must not leave returning visitors frozen.
    await page.addInitScript(() => sessionStorage.setItem('shinobij:landing-atmosphere-paused', '1'));
    await page.goto('/', { waitUntil: 'networkidle' });
    const atmosphere = page.locator('.landing-atmosphere');
    const ember = page.locator('.landing-ember').first();
    const transform = () => ember.evaluate(element => getComputedStyle(element).transform);
    await expect(atmosphere).toHaveAttribute('data-running', 'true');
    const initialTransform = await transform();
    await expect.poll(transform).not.toBe(initialTransform);
    for (const selector of ['.landing-valley-mist--far', '.landing-valley-mist--near', '.landing-tail-aura', '.landing-canopy-fleck']) {
        const layer = page.locator(selector).first();
        await expect(layer).toBeVisible();
        const firstTransform = await layer.evaluate(element => getComputedStyle(element).transform);
        await expect.poll(() => layer.evaluate(element => getComputedStyle(element).transform)).not.toBe(firstTransform);
    }

    await expect(page.getByRole('button', { name: /(?:Pause|Play) background animation/ })).toHaveCount(0);
    await page.locator('.landing-footer').scrollIntoViewIfNeeded();
    await expect(atmosphere).toHaveAttribute('data-running', 'false');
    await expect(ember).toHaveCSS('animation-play-state', 'paused');
    for (const selector of ['.landing-valley-mist--far', '.landing-valley-mist--near', '.landing-tail-aura', '.landing-canopy-fleck']) {
        await expect(page.locator(selector).first()).toHaveCSS('animation-play-state', 'paused');
    }
    await page.getByRole('button', { name: 'Shinobi Journey home' }).click();
    await expect(atmosphere).toHaveAttribute('data-running', 'true');

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /(?:Pause|Play) background animation/ })).toHaveCount(0);
    await expect(page.locator('.landing-ember:visible')).toHaveCount(14);
    await expect(page.locator('.landing-valley-mist--near')).toBeHidden();
    await expect(page.locator('.landing-tail-aura')).toBeHidden();
    await expectNoHorizontalOverflow(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(atmosphere).toBeHidden();
    await expect(ember).toHaveCSS('animation-name', 'none');
    await expect(page.getByTestId('start-create')).toBeVisible();
});

test('landing scroll reveals play once and keep focused content readable', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const heading = page.locator('.landing-features .landing-section-head');
    // Progressive enhancement: offscreen content has no waiting/hidden state.
    await expect(heading).toHaveCSS('opacity', '1');
    await heading.evaluate(element => {
        element.setAttribute('data-entrance-count', '0');
        element.addEventListener('animationstart', event => {
            if ((event as AnimationEvent).animationName === 'landing-section-reveal') {
                element.setAttribute('data-entrance-count', String(Number(element.getAttribute('data-entrance-count')) + 1));
            }
        });
    });
    const distance = await heading.evaluate(element => element.getBoundingClientRect().top - 300);
    await page.mouse.wheel(0, distance);
    await expect(heading).toHaveAttribute('data-entrance-count', '1');
    await expect(heading).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Shinobi Journey home' }).click();
    await expect(page.locator('.landing-atmosphere')).toHaveAttribute('data-running', 'true');
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toHaveAttribute('data-entrance-count', '1');

    const card = page.locator('.landing-feature-card').last();
    await card.focus();
    await expect(card).toBeFocused();
    await expect(card).toHaveCSS('animation-name', 'none');
    await expect(card).toHaveCSS('opacity', '1');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.landing-begin-inner').scrollIntoViewIfNeeded();
    await expect(page.locator('.landing-begin-inner')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.landing-begin-inner')).toHaveCSS('opacity', '1');
    await expectNoHorizontalOverflow(page);
});

test('landing hero - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'landing-desktop.png');
});

test('landing hero - compact', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'landing-compact.png');
});

test('landing hero - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await expect(page.getByTestId('start-create')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await screenshot(page, 'landing-mobile.png');
});

test('landing wide monitors preserve the shinobi and fox artwork', async ({ page }, testInfo) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    for (const viewport of [
        { width: 2553, height: 1264 },
        { width: 3440, height: 1440 },
        { width: 1920, height: 800 },
        { width: 1920, height: 1080 },
    ]) {
        await page.setViewportSize(viewport);
        await expectNoHorizontalOverflow(page);
        const composition = await page.locator('.landing-hero').evaluate(async (hero) => {
            const scene = getComputedStyle(hero, '::before');
            const image = new Image();
            image.src = '/landing/hero-shinobi.webp';
            await image.decode();
            const width = parseFloat(scene.width), height = parseFloat(scene.height);
            const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
            const position = scene.backgroundPosition.split(',').at(-1)!.trim().split(/\s+/);
            const top = (height - image.naturalHeight * scale) * parseFloat(position[1]) / 100;
            const left = (width - image.naturalWidth * scale) * parseFloat(position[0]) / 100;
            const atmosphere = hero.querySelector('.landing-atmosphere')!.getBoundingClientRect();
            // Authored image bounds enclosing the hair, fox, and glowing tail.
            return {
                sceneVisible: scene.content !== 'none',
                headTop: top + 95 * scale,
                tailBottom: top + 755 * scale,
                subjectLeft: left + 1110 * scale,
                subjectRight: left + 1550 * scale,
                width, height, atmosphereWidth: atmosphere.width,
            };
        });
        expect(composition.sceneVisible).toBe(true);
        expect(composition.headTop).toBeGreaterThan(12);
        expect(composition.tailBottom).toBeLessThan(composition.height - 12);
        expect(composition.subjectLeft).toBeGreaterThan(0);
        expect(composition.subjectRight).toBeLessThan(composition.width);
        expect(composition.atmosphereWidth).toBeCloseTo(composition.width, 0);
        if (viewport.width === 2553) {
            await testInfo.attach('wide-monitor-composition', { body: await page.screenshot(), contentType: 'image/png' });
        }
    }
});
test('landing discovery and Discord links stay still on hover', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    for (const control of [page.getByRole('button', { name: 'Discover your journey' }), page.getByRole('link', { name: /Join the Discord/ })]) {
        await control.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        const before = await control.boundingBox();
        await control.hover();
        expect(await control.boundingBox()).toEqual(before);
    }
});

test('landing mobile gallery shows four playable modes and enlarges each capture', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await page.getByRole('tab', { name: 'On Mobile', exact: true }).click();
    const gallery = page.locator('.landing-mobile-gallery');
    await expect(gallery.getByRole('button')).toHaveCount(4);
    await gallery.locator('img').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => (image as HTMLImageElement).decode()));
    });
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-gallery-panel'), 'landing-mobile-gallery.png');
    const modes = [['Jutsu Combat', 'mobile-combat'], ['Card Battles', 'mobile-cards'], ['Pet Arena', 'mobile-pet-arena'], ['Story', 'mobile-story']];
    for (const [label, file] of modes) {
        const trigger = gallery.getByRole('button', { name: `Enlarge mobile ${label} screenshot` });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: `${label} screenshot`, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('img')).toHaveAttribute('src', `/landing/${file}.webp`);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await expect(trigger).toBeFocused();
    }
    for (const width of [320, 768, 1366]) {
        await page.setViewportSize({ width, height: 900 });
        await expectNoHorizontalOverflow(page);
        await expect(gallery.getByRole('button')).toHaveCount(4);
    }
});

test('landing finale - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const finale = page.locator('.landing-begin');
    await expect(finale).toBeVisible();
    await finale.scrollIntoViewIfNeeded();
    await settleVisualState(page);
    // Isolate the long section capture from the sticky global nav. Playwright
    // stitches element screenshots taller than the viewport and would otherwise
    // composite the sticky bar through the middle of the section artwork.
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await expect(finale).toHaveScreenshot('landing-finale-desktop.png', {
        animations: 'disabled',
        caret: 'hide',
    });
});

test('landing story sections - desktop', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-features'), 'landing-features-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-band'), 'landing-band-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-clan').nth(0), 'landing-clan-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-clan').nth(1), 'landing-legacy-desktop.png');
    await sectionScreenshot(page, page.locator('.landing-footer'), 'landing-footer-desktop.png');
});

test('landing story sections - tablet', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-features'), 'landing-features-tablet.png');
    await sectionScreenshot(page, page.locator('.landing-clan').first(), 'landing-clan-tablet.png');
});

test('landing story sections - mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    await expectNoHorizontalOverflow(page);
    await page.addStyleTag({ content: '.landing-topbar { visibility: hidden !important; }' });
    await sectionScreenshot(page, page.locator('.landing-features'), 'landing-features-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-band'), 'landing-band-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-clan').first(), 'landing-clan-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-clan').nth(1), 'landing-legacy-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-begin'), 'landing-finale-mobile.png');
    await sectionScreenshot(page, page.locator('.landing-footer'), 'landing-footer-mobile.png');
});

test('landing entry points open the connected creator, account, guides, and leaderboard', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const entries = [
        ['.landing-nav-play', 'Begin as a Shinobi', 'Back to Landing'],
        ['[data-testid="start-create"]', 'Begin as a Shinobi', 'Back to Landing'],
        ['.landing-begin button', 'Begin as a Shinobi', 'Back to Landing'],
        ['.landing-footer-links button:nth-child(1)', 'Begin as a Shinobi', 'Back to Landing'],
        ['.landing-utility button', 'Enter the Village', 'Back'],
        ['.landing-desktop-login', 'Enter the Village', 'Back'],
        ['.landing-footer-links button:nth-child(4)', 'Enter the Village', 'Back'],
        ['.landing-topnav button:nth-child(3)', 'Game guides', 'Return'],
        ['.landing-story button', 'Game guides', 'Return'],
        ['#landing-companions button', 'Game guides', 'Return'],
        ['.landing-footer-links button:nth-child(2)', 'Game guides', 'Return'],
        ['.landing-topnav button:nth-child(4)', 'Hall of Legends', 'Back'],
        ['.landing-footer-links button:nth-child(3)', 'Hall of Legends', 'Back'],
    ];
    for (const [selector, heading, back] of entries) {
        await test.step(selector, async () => {
            await page.locator(selector).click({ timeout: 10_000 });
            await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
            await page.getByRole('button', { name: back, exact: true }).click({ timeout: 10_000 });
            await expect(page.getByTestId('start-create')).toBeVisible();
        });
    }
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await page.getByRole('button', { name: 'Use a name and password', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    await expect(page.getByPlaceholder('Enter your password')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await expect(page.getByPlaceholder('Enter your password')).toHaveAttribute('type', 'password');
});

test('landing policy links resolve to distinct documents and community links agree', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    const communityLinks = page.locator('#landing-home a[href^="https://discord.gg/"]');
    await expect(communityLinks).toHaveCount(2);
    for (const link of await communityLinks.all()) {
        await expect(link).toHaveAttribute('href', 'https://discord.gg/usr3vzykBh');
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    const titles = new Set<string>();
    for (const link of LEGAL_PAGE_LINKS) {
        await page.getByRole('navigation', { name: 'Legal and player policies' }).getByRole('link', { name: link.label, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`/${link.slug}$`));
        const heading = page.locator('.legal-page-header h1');
        await expect(heading).toBeVisible();
        titles.add(await heading.innerText());
        await page.getByRole('link', { name: 'Back to Shinobi Journey home', exact: true }).click();
        await expect(page.getByTestId('start-create')).toBeVisible();
    }
    expect(titles.size).toBe(LEGAL_PAGE_LINKS.length);
});

test('landing navigation, gallery keyboard controls, and reduced motion work together', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await settleVisualState(page);
    for (const [selector, destination] of [
        ['.landing-scroll-cue', '#landing-discover'],
        ['.landing-feature-card:nth-child(1)', '#landing-story'],
        ['.landing-feature-card:nth-child(2)', '#landing-companions'],
        ['.landing-feature-card:nth-child(3)', '#landing-gameplay'],
    ]) {
        await page.locator(selector).click();
        await expect(page.locator(destination)).toBeFocused();
        // Explicit scrollIntoView({ behavior: 'smooth' }) keeps moving even
        // when the screenshot helper disables CSS scroll-behavior. Wait for
        // arrival before Playwright scrolls back to click the next feature.
        await expect.poll(() => page.locator(destination).evaluate(element => {
            const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
            return Math.abs(element.getBoundingClientRect().top - margin) < 2;
        })).toBe(true);
    }
    await expect(page.locator('.landing-lightbox img')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Jutsu Combat', exact: true }).press('ArrowRight');
    const cards = page.getByRole('tab', { name: 'Card Battles', exact: true });
    await expect(cards).toBeFocused();
    await expect(cards).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Enlarge Card Battles screenshot', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Close screenshot', exact: true })).toBeFocused();
    await expect(page.locator('html')).toHaveCSS('overflow-y', 'hidden');
    await page.keyboard.press('Escape');
    await expect(page.locator('.landing-lightbox img')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enlarge Card Battles screenshot', exact: true })).toBeFocused();
    await cards.press('End');
    await expect(page.getByRole('tab', { name: 'On Mobile', exact: true })).toBeFocused();
    await page.getByRole('tab', { name: 'On Mobile', exact: true }).press('Home');
    await expect(page.getByRole('tab', { name: 'Jutsu Combat', exact: true })).toBeFocused();
    for (const selector of ['.landing-brand', '.landing-utility button', '.landing-gallery-tabs button:first-child', '.landing-gallery-image', '.landing-footer-links button:first-child']) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await control.hover();
        // Hover may scroll a tab out from under the sticky header. Assert the
        // hover effect itself rather than mistaking that scroll for animation.
        await expect(control).toHaveCSS('transform', 'none');
        await expect(control).toHaveCSS('box-shadow', 'none');
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('start-create').hover();
    await expect(page.getByTestId('start-create')).toHaveCSS('transform', 'none');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: 'The World', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Gameplay', exact: true }).press('Enter');
    await expect(page.locator('#landing-gameplay')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expectNoHorizontalOverflow(page);
});

test('landing assets and social previews load without page errors', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/', { waitUntil: 'networkidle' });
    const assets = new Set(await page.locator('#landing-home img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src)));
    for (const label of ['Card Battles', 'Pet Arena', 'Story', 'On Mobile']) {
        await page.getByRole('tab', { name: label, exact: true }).click();
        for (const src of await page.locator('.landing-gallery-panel img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) assets.add(src);
    }
    const backgroundAssets = await page.locator('#landing-home, #landing-home *').evaluateAll(elements => elements.flatMap(el => Array.from(getComputedStyle(el).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g), match => match[1])));
    backgroundAssets.forEach(src => assets.add(src));
    const shareImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(shareImage).toBe('https://shinobijourney.com/landing/hero-shinobi.webp');
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', shareImage!);
    assets.add(new URL(shareImage!).pathname);
    for (const src of assets) {
        const response = await request.get(src);
        expect(response.status(), src).toBe(200);
        expect(response.headers()['content-type'], src).toMatch(/^image\//);
    }
    expect(errors).toEqual([]);
});

test('landing play buttons respect an explicit registration pause', async ({ page }) => {
    await page.route('**/api/player/capabilities', route => json(route, { ok: true, capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map(id => [id, id === 'registrations' ? { state: 'temporarily-unavailable', reason: 'temporarily-disabled' } : { state: 'available', reason: 'available' }])) }));
    await page.goto('/', { waitUntil: 'networkidle' });
    for (const selector of ['.landing-nav-play', '[data-testid="start-create"]', '.landing-begin button', '.landing-footer-links button:first-child']) {
        await expect(page.locator(selector)).toBeDisabled();
    }
    await expect(page.locator('.landing-hero [role="status"]')).toContainText(/registration|creation|paused/i);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Enter the Village', exact: true })).toBeVisible();
});

test('character creator entry', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.getByTestId('start-create').click();
    await expect(page.getByRole('heading', { name: 'Begin as a Shinobi' })).toBeVisible();
    await screenshot(page, 'character-creator-desktop.png');
});

test('authenticated Central Hub shell', async ({ page }) => {
    const character = {
        name: 'VisualNinja', village: 'Ember', specialty: 'Ninjutsu', bloodline: 'None',
        level: 12, rankTitle: 'Chunin', xp: 2400, ryo: 1800, unspentStats: 0,
        stats: {
            strength: 20, speed: 22, intelligence: 24, willpower: 20,
            bukijutsuOffense: 18, bukijutsuDefense: 18,
            taijutsuOffense: 18, taijutsuDefense: 18,
            genjutsuOffense: 18, genjutsuDefense: 18,
            ninjutsuOffense: 24, ninjutsuDefense: 22,
        },
        // Use the stat-derived full pools so passive regeneration cannot move a
        // visual baseline by one pixel/second while the page settles.
        hp: 1600, maxHp: 1600, chakra: 2000, maxChakra: 2000, stamina: 2000, maxStamina: 2000,
        onboardingStep: 'done', inventory: [], itemStacks: [], equipment: {}, pets: [],
        jutsuMastery: [], equippedJutsuIds: [], pendingCombatMissionClaims: [],
        storyProgress: 9, storyVillage: 'Ember', storyTraits: [],
    };
    await page.unroute('**/api/**');
    await page.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname.toLowerCase();
        if (path === '/api/save/visualninja') {
            return json(route, { character, currentBiome: 'central', currentSector: 40, acceptedMissionIds: [], missionProgress: {}, triggeredEvents: ['builtin-aura-sphere-lv9'], _saveVersion: 1 });
        }
        if (path === '/api/player-auth') return json(route, { ok: true, token: 'visual-session-token' });
        if (path === '/api/perf-beacon') return route.fulfill({ status: 204 });
        if (path === '/api/battle-lock') return json(route, { lock: null });
        if (path === '/api/weekly-boss') return json(route, { boss: null, fightEnabled: true });
        if (path === '/api/ranked-season') return json(route, { current: null, lastSeason: null });
        if (path === '/api/legacy/status') return json(route, { enabled: false });
        // The player surface is gated on a live capability answer
        // (LiveCapabilitiesProvider / PlayerSurfaceBlocker). The generic
        // fallback below returns no `capabilities` key, which reads as "still
        // checking" and parks the app on "Reconnecting to your save" forever —
        // which is exactly how this spec silently rotted after the capability
        // system landed. Mirrors e2e/helpers/ui-audit-runtime.ts.
        if (path === '/api/player/capabilities') {
            return json(route, {
                ok: true,
                capabilities: Object.fromEntries(PUBLIC_CAPABILITY_IDS.map((id) => [
                    id,
                    { state: 'available', reason: 'available' },
                ])),
            });
        }
        return json(route, { ok: true, images: {}, categories: {}, players: [], leaderboard: [], announcements: [], entries: [], eras: [], wars: [], territories: [], standings: [] });
    });
    await page.addInitScript(() => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: 'VisualNinja' }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ visualninja: { token: 'visual-session-token' } }));
        localStorage.setItem('shinobix:activePlayerPersist', 'VisualNinja');
        localStorage.setItem('shinobix:activeTokenPersist', 'visual-session-token');
    });
    await page.goto('/#/centralHub', { waitUntil: 'networkidle' });
    const dismissPatchNotes = page.getByRole('button', { name: 'Got it' });
    if (await dismissPatchNotes.isVisible()) await dismissPatchNotes.click();
    // The h1 is two spans ("Central" + "The Thousand Gates") with the separator
    // supplied by CSS, so the accessible name has no em dash in it. Match on the
    // words rather than the punctuation: this locator previously pinned a dash
    // that the DOM never contained, and the failure looked like a broken hub.
    await expect(page.getByRole('heading', { name: /Central\s+The Thousand Gates/ })).toBeVisible();
    await screenshot(page, 'central-hub-desktop.png');
});

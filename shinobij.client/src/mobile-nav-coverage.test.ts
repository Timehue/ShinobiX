import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { viewportClassForWidth } from './lib/viewport-contract';

/*
 * Every viewport width must have SOME navigation.
 *
 * There are two navigation surfaces and they hand off at one width: the desktop
 * right rail + left profile card (hidden below a bound in 18-mobile-safe-adaptive.css)
 * and the mobile shell — bottom nav, top status HUD, notification strip — (revealed
 * below a bound in 23-mobile-shell.css). If the reveal bound is SMALLER than the hide
 * bound, the widths in between have neither.
 *
 * That regression shipped: the rail hid at 980px while the shell only appeared at
 * 800px, so 801-980px — iPad portrait (820/834), every phone in landscape (852-932),
 * and any resized desktop window — had no nav, no HP/chakra readout, and no way to
 * log out. Inventory and Profile are not on the village facility map, so a player who
 * rotated their phone could not equip gear.
 *
 * These tests pin the two bounds together so the handoff stays exact in both
 * directions: widening the rail's hide bound without widening the shell's reveal
 * re-opens the gap, and narrowing the shell's reveal does the same.
 */

const stylesDir = join(process.cwd(), 'shinobij.client', 'src', 'styles');
const shellCss = readFileSync(join(stylesDir, 'layout', 'adaptive-shell.css'), 'utf8');

interface MediaBlock { maxWidth: number; body: string }

/**
 * Every `@media (max-width: Npx)` block in `css`, paired with its brace-matched body.
 * Nested blocks yield separate entries, so an outer block's body still contains its
 * children — `boundFor` resolves that by preferring the innermost match.
 */
function mediaBlocks(css: string): MediaBlock[] {
    const blocks: MediaBlock[] = [];
    const opener = /@media \(max-width:\s*(\d+)px\)\s*\{/g;
    for (let m = opener.exec(css); m !== null; m = opener.exec(css)) {
        let depth = 1;
        let i = m.index + m[0].length;
        const bodyStart = i;
        while (i < css.length && depth > 0) {
            const ch = css[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            i++;
        }
        assert.equal(depth, 0, `unterminated @media block at offset ${m.index}`);
        blocks.push({ maxWidth: Number(m[1]), body: css.slice(bodyStart, i - 1) });
    }
    return blocks;
}

/**
 * The max-width of the innermost media block whose body matches `pattern`.
 * Innermost wins so a rule nested inside a wider block reports its own bound.
 */
function boundFor(css: string, pattern: RegExp, label: string): number {
    const matching = mediaBlocks(css).filter((b) => pattern.test(b.body));
    assert.ok(matching.length > 0, `no @media block contains ${label}`);
    return matching.reduce((best, b) => (b.body.length < best.body.length ? b : best)).maxWidth;
}

// The rail/profile-card hide block — the one that actually sets display:none on them.
const RAIL_HIDDEN = /\.right-menu-panel[\s\S]*?\{\s*display:\s*none/;
const NAV_SHOWN = /\.mobile-bottom-nav\s*\{\s*display:\s*flex/;
const HUD_SHOWN = /\.mobile-top-hud\s*\{\s*display:\s*flex/;
const NAV_CLEARANCE = /--shell-mobile-nav-clearance/;

test('the mobile shell appears exactly where the desktop rail disappears', () => {
    const railHidesAt = boundFor(shellCss, RAIL_HIDDEN, 'the desktop rail hide rule');
    const navShownAt = boundFor(shellCss, NAV_SHOWN, 'the mobile bottom nav reveal');

    assert.equal(
        navShownAt,
        railHidesAt,
        `nav gap: the rail hides at ${railHidesAt}px but the mobile bottom nav only appears at ` +
        `${navShownAt}px, leaving ${navShownAt + 1}-${railHidesAt}px with no navigation at all`,
    );
});

test('the mobile status HUD shares the shell breakpoint', () => {
    // The HUD replaces the left profile card, which hides on the same bound as the
    // rail — so a narrower reveal loses HP/chakra/stamina and the per-screen back arrow.
    const railHidesAt = boundFor(shellCss, RAIL_HIDDEN, 'the desktop rail hide rule');
    const hudShownAt = boundFor(shellCss, HUD_SHOWN, 'the mobile top HUD reveal');

    assert.equal(hudShownAt, railHidesAt, `mobile top HUD reveals at ${hudShownAt}px, rail hides at ${railHidesAt}px`);
});

test('bottom clearance is reserved wherever the fixed nav is shown', () => {
    // The rail-hide block sets `padding` as a shorthand, which wipes any bottom padding
    // set earlier — so the clearance rule has to cover every width where the nav is
    // fixed to the bottom, or the nav sits on the page's own bottom controls.
    const navShownAt = boundFor(shellCss, NAV_SHOWN, 'the mobile bottom nav reveal');
    const clearanceAt = boundFor(shellCss, NAV_CLEARANCE, 'the center-game nav clearance');

    assert.ok(
        clearanceAt >= navShownAt,
        `nav is shown at ≤${navShownAt}px but bottom clearance is only reserved at ≤${clearanceAt}px`,
    );
});

test('the JavaScript viewport classifier shares the 979/980 shell handoff', () => {
    assert.equal(viewportClassForWidth(979), 'sm');
    assert.equal(viewportClassForWidth(980), 'md');
});

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// index.css is a pure @import manifest (split 2026-07-18); the rules these
// tests assert on live in the ./styles/index/NN-*.css parts. Concatenating the
// parts in manifest order reproduces the old monolith body, so the positional
// assertions below (indexOf/lastIndexOf) keep their original semantics.
const indexManifest = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'index.css'), 'utf8');
const css = [...indexManifest.matchAll(/@import "\.\/(styles\/index\/[\w.-]+\.css)";/g)]
    .map((m) => readFileSync(join(process.cwd(), 'shinobij.client', 'src', ...m[1].split('/')), 'utf8'))
    .join('');
const introCss = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'features', 'intro-cinematic', 'intro-cinematic.css'), 'utf8');
const battleSkinCss = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'styles', 'battle-skin.css'), 'utf8');
const nextGoalSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'components', 'NextGoalPin.tsx'), 'utf8');
const visualNovelSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'components', 'TriggeredVisualNovel.tsx'), 'utf8');

function rule(selector: string): string {
    const start = css.indexOf(`${selector} {`);
    assert.notEqual(start, -1, `missing CSS rule for ${selector}`);
    const end = css.indexOf('}', start);
    assert.notEqual(end, -1, `unterminated CSS rule for ${selector}`);
    return css.slice(start, end);
}

test('mobile shell buttons keep a 44px minimum touch height', () => {
    const marker = css.indexOf('/* General mobile touch improvements */');
    assert.notEqual(marker, -1, 'missing general mobile touch improvements rule');
    assert.match(css.slice(marker, marker + 160), /button\s*\{[^}]*min-height:\s*44px/s);
});

test('mobile menu and profile close controls remain 44px square', () => {
    for (const selector of ['.mobile-menu-close', '.mobile-profile-sheet-close']) {
        const body = rule(selector);
        assert.match(body, /width:\s*44px(?:\s*!important)?/);
        assert.match(body, /height:\s*44px/);
    }
});

test('clan boss party action remains a full-size touch target', () => {
    assert.match(rule('.clan-boss-party-btn'), /min-height:\s*44px/);
});

test('onboarding overlay and next-goal controls meet the phone touch target', () => {
    assert.match(introCss, /\.icx-skip\.icx-sound\s*\{[^}]*min-width:\s*44px/s);
    assert.match(nextGoalSource, /minWidth:\s*compactButton \? 20 : 44/);
    assert.match(nextGoalSource, /minHeight:\s*compactButton \? 20 : 44/);
});

test('visual novel skip stays visible in the header with a phone-size target', () => {
    assert.match(visualNovelSource, /className="vn-header-actions"[\s\S]*className="vn-skip-button"/);
    const mobileRule = css.lastIndexOf('.vn-skip-button {');
    assert.notEqual(mobileRule, -1, 'missing mobile VN skip rule');
    assert.match(css.slice(mobileRule, css.indexOf('}', mobileRule)), /min-height:\s*44px/);
});

test('visual novel navigation and choice actions keep 44px touch targets in portrait and landscape', () => {
    assert.match(rule('.vn-choice-btn'), /min-height:\s*44px/);
    assert.match(css, /\.vn-controls button,\s*\.vn-choice-row button,\s*\.vn-finale-panel \.menu button\s*\{[^}]*min-height:\s*44px/s);
    assert.match(css, /\.vn-controls button,\s*\.vn-choice-row button\s*\{[^}]*min-height:\s*44px\s*!important/s);
});

test('mobile combat VFX stay fighter-sized while preserving capped visual hierarchy', () => {
    // Anchor on the rule itself, then walk back to the media block that OWNS it.
    // This used to slice from the first `max-width: 800px` block in the file to
    // the next `420px` one, which only contained these rules by accident — the
    // span happened to be ~1900 lines wide, and deleting an unrelated 800px block
    // elsewhere silently moved the window off them.
    const vfxRuleAt = battleSkinCss.indexOf('.arena-fullscreen .pvp-combat-vfx {');
    assert.notEqual(vfxRuleAt, -1, 'missing the mobile combat-VFX sizing rule');
    const opens = [...battleSkinCss.slice(0, vfxRuleAt).matchAll(/@media \(max-width:\s*(\d+)px\)\s*\{/g)];
    assert.ok(opens.length, 'the mobile combat-VFX rules must live inside a max-width block');
    const owningBlock = opens[opens.length - 1];
    assert.equal(
        owningBlock[1], '1023',
        `mobile combat VFX are gated at max-width ${owningBlock[1]}px but the combat shell switches at 1023px — `
        + 'they would be desktop-sized across the gap',
    );
    // Everything from the owning block's start up to the next narrower tier.
    const phoneStart = battleSkinCss.indexOf('@media (max-width: 420px)', vfxRuleAt);
    assert.notEqual(phoneStart, -1, 'missing phone battle skin boundary');
    const mobileCss = battleSkinCss.slice(owningBlock.index!, phoneStart);
    assert.match(mobileCss, /\.arena-fullscreen \.pvp-combat-vfx\s*\{[\s\S]*?--vfx-scale:\s*1\s*!important;[\s\S]*?--vfx-render-scale:\s*clamp\(0\.92,\s*var\(--vfx-asset-scale,\s*1\),\s*1\.25\);[\s\S]*?width:\s*52px\s*!important;[\s\S]*?height:\s*52px\s*!important;/);
    assert.match(mobileCss, /\.arena-fullscreen \.pvp-combat-vfx-tile\s*\{[\s\S]*?width:\s*36px\s*!important;[\s\S]*?height:\s*36px\s*!important;/);
    assert.match(mobileCss, /\.arena-fullscreen \.pvp-vfx-asset\s*\{[\s\S]*?width:\s*112%\s*!important;[\s\S]*?height:\s*112%\s*!important;/);
});

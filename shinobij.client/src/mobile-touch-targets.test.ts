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
const landingSkinCss = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'styles', 'landing-skin.css'), 'utf8');
const adaptiveShellCss = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'styles', 'layout', 'adaptive-shell.css'), 'utf8');
const veiledSteelCss = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'styles', 'veiled-steel.css'), 'utf8');
const storageNoticeSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'components', 'StorageNotice.tsx'), 'utf8');
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
    assert.doesNotMatch(nextGoalSource, /compactButton\s*\?\s*20\s*:\s*44/);
    assert.doesNotMatch(nextGoalSource, /<button\b/);
    assert.match(nextGoalSource, /<Button[\s\S]*className="next-goal-pin-compact__action"/);
    assert.match(veiledSteelCss, /\.next-goal-pin-compact__heading\s*\{[^}]*min-height:\s*var\(--touch-target-min\)[^}]*overflow:\s*visible/s);
    assert.match(veiledSteelCss, /\.next-goal-pin-compact__close\s*\{[^}]*width:\s*var\(--touch-target-min\)[^}]*height:\s*var\(--touch-target-min\)[^}]*min-width:\s*var\(--touch-target-min\)[^}]*min-height:\s*var\(--touch-target-min\)/s);
    assert.match(veiledSteelCss, /:where\([\s\S]*?\.next-goal-pin__action,[\s\S]*?\.next-goal-pin-compact__action[\s\S]*?\)\s*\{[^}]*min-width:\s*var\(--touch-target-min\)[^}]*min-height:\s*var\(--touch-target-min\)/s);
});

test('landing and storage-notice actions use the shared mobile touch target', () => {
    assert.match(landingSkinCss, /\.landing-topnav \.landing-navlink\s*\{[^}]*min-height:\s*var\(--touch-target-min\)/s);
    assert.match(landingSkinCss, /\.landing-footer-links :is\(a, button\),\s*\.landing-footer-policy-links a\s*\{[^}]*min-width:\s*var\(--touch-target-min\)[^}]*min-height:\s*var\(--touch-target-min\)/s);
    assert.match(adaptiveShellCss, /\.storage-notice :where\(a, button\)\s*\{[^}]*min-block-size:\s*var\(--touch-target-min\)/s);
    assert.match(storageNoticeSource, /minHeight:\s*"var\(--touch-target-min\)"/);
    assert.doesNotMatch(storageNoticeSource, /minHeight:\s*38/);
});

test('next-goal controls retain keyboard, progress, and reduced-motion semantics', () => {
    assert.match(nextGoalSource, /aria-label="Hide this goal"/);
    assert.match(nextGoalSource, /<ProgressBar[\s\S]*?label=\{`\$\{req\.label\} progress`\}[\s\S]*?value=\{req\.progress\}[\s\S]*?max=\{req\.target\}/s);
    assert.match(veiledSteelCss, /:where\([\s\S]*?\.next-goal-pin__close,[\s\S]*?\.next-goal-pin__action,[\s\S]*?\.next-goal-pin-compact__action[\s\S]*?\):focus-visible\s*\{[^}]*outline:/s);
    assert.match(veiledSteelCss, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.next-goal-pin__progress \.ui-progress-fill[\s\S]*?transition:\s*none !important;/s);
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
    const mobileStart = battleSkinCss.indexOf('@media (max-width: 800px)');
    const phoneStart = battleSkinCss.indexOf('@media (max-width: 420px)', mobileStart);
    assert.notEqual(mobileStart, -1, 'missing mobile battle skin');
    assert.notEqual(phoneStart, -1, 'missing phone battle skin boundary');
    const mobileCss = battleSkinCss.slice(mobileStart, phoneStart);
    assert.match(mobileCss, /\.arena-fullscreen \.pvp-combat-vfx\s*\{[\s\S]*?--vfx-scale:\s*1\s*!important;[\s\S]*?--vfx-render-scale:\s*clamp\(0\.92,\s*var\(--vfx-asset-scale,\s*1\),\s*1\.25\);[\s\S]*?width:\s*52px\s*!important;[\s\S]*?height:\s*52px\s*!important;/);
    assert.match(mobileCss, /\.arena-fullscreen \.pvp-combat-vfx-tile\s*\{[\s\S]*?width:\s*36px\s*!important;[\s\S]*?height:\s*36px\s*!important;/);
    assert.match(mobileCss, /\.arena-fullscreen \.pvp-vfx-asset\s*\{[\s\S]*?width:\s*112%\s*!important;[\s\S]*?height:\s*112%\s*!important;/);
});

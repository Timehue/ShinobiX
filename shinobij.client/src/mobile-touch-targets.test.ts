import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const css = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'index.css'), 'utf8');
const introCss = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'features', 'intro-cinematic', 'intro-cinematic.css'), 'utf8');
const nextGoalSource = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'components', 'NextGoalPin.tsx'), 'utf8');

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
    assert.match(nextGoalSource, /minWidth:\s*44/);
    assert.match(nextGoalSource, /minHeight:\s*44/);
});

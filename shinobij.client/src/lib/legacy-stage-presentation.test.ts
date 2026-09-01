import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (file: string) => readFileSync(
    join(process.cwd(), 'shinobij.client', 'src', 'screens', file),
    'utf8',
);

test('Stage I does not equip the Stage II badge or public profile showcase', () => {
    const ownPanel = source('LegacyPanel.tsx');
    const publicProfile = source('UserView.tsx');

    assert.match(ownPanel, /status\.legacy\.stage >= 2 && def\.badge/,
        'the accepted-path panel must not equip badge art before awakening');
    assert.doesNotMatch(ownPanel, /Math\.max\(2, status\.legacy\.stage\)/,
        'Stage I must never be cosmetically promoted to the Stage II aura');
    assert.match(publicProfile, /viewedCharacter\.legacy\.stage >= 2/,
        'the public Legacy hero band begins at the documented profile-display stage');
    assert.doesNotMatch(publicProfile, /\?\? viewedLegacyDef\.title/,
        'public profiles must never synthesize an unearned title');
});

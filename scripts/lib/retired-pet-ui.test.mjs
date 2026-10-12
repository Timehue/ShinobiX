import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertNoRetiredPetUi } from './retired-pet-ui.mjs';

function fixture(context, filename, source) {
    const directory = mkdtempSync(join(tmpdir(), 'pet-arena-release-'));
    const file = join(directory, filename);
    writeFileSync(file, source);
    context.after(() => { unlinkSync(file); rmdirSync(directory); });
    return file;
}

test('release rejects the retired fight-plan renderer in an emitted chunk', context => {
    const file = fixture(context, 'duel.js', 'render("Choose the Fight Plan")');
    assert.throws(() => assertNoRetiredPetUi([file]), /Retired pet battle UI marker.*duel\.js/);
});

test('release rejects the retired realtime host even without the fight-plan label', context => {
    const file = fixture(context, 'host.mjs', 'render({"data-testid":"pet-duel-live-sides"})');
    assert.throws(() => assertNoRetiredPetUi([file]), /Retired pet battle UI marker.*host\.mjs/);
});

test('current commands and non-executable historical evidence can ship', context => {
    const current = fixture(context, 'arena.js', 'render("Pet Arena", "Plan your next play")');
    const history = fixture(context, 'receipt.json', '{"oldLabel":"Choose the Fight Plan"}');
    assert.doesNotThrow(() => assertNoRetiredPetUi([current, history]));
});

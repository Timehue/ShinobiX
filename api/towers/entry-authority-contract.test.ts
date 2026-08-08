import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('Tower start reserves the stored-wallet fee before publishing a run', () => {
    const start = readFileSync(join(root, 'api/towers/start.ts'), 'utf8');
    const debit = start.indexOf('debitTowerEntry(char');
    const save = start.indexOf('writeSaveProjected(saveKey');
    const publish = start.indexOf('await writeSession(session)');
    assert.ok(debit > 0 && save > debit && publish > save);

    const client = readFileSync(join(root, 'shinobij.client/src/screens/BattleTowersLobby.tsx'), 'utf8');
    assert.doesNotMatch(client, /payBattleEntry/);
    assert.match(client, /authoritativeCharacter/);
});

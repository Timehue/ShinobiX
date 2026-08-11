import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('Tower start reserves first-clear fees, preserves free replays, and compensates before publishing a run', () => {
    const start = readFileSync(join(root, 'api/towers/start.ts'), 'utf8');
    const debit = start.indexOf('reserveTowerDirectEntry({');
    const save = start.indexOf('writeSaveProjected(saveKey', debit);
    const publish = start.indexOf('await writeSession(session)');
    assert.ok(debit > 0 && save > debit && publish > save);
    const verify = start.indexOf('published = await readSession(runId)', publish);
    const compensate = start.indexOf('refundTowerDirectEntryReservation({', verify);
    assert.ok(verify > publish && compensate > verify, 'a failed publish is verified absent before the stored-wallet refund');
    const partyDebit = start.indexOf('reserveTowerPartyEntry({');
    const partyRefund = start.indexOf('refundTowerPartyEntryReservation({', verify);
    assert.ok(partyDebit > 0 && partyDebit < publish && partyRefund > verify, 'party launch uses a durable save-local fee receipt and verified compensation');
    assert.match(start, /floorId: entryFloor\.id/);
    assert.match(start, /sealedStoryFloorForSession\(session\)/);
    assert.match(start, /charged: reserved\.charged/);
    assert.match(start, /storyTowerMemberRequirements\(storyMembers, floorNum\)/);
    assert.match(start, /memberRequirements: storyRequirements/);

    const client = readFileSync(join(root, 'shinobij.client/src/screens/BattleTowersLobby.tsx'), 'utf8');
    assert.doesNotMatch(client, /payBattleEntry/);
    assert.match(client, /authoritativeCharacter/);
});

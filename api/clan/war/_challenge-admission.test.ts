import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON,
    clanWarChallengeAdmissionError,
} from './_challenge-admission.js';

describe('Clan War shinobi 2v2 admission', () => {
    it('blocks every action that could progress a new or retained 2v2 queue', () => {
        for (const action of ['send', 'join-send', 'accept', 'join-accept']) {
            assert.equal(clanWarChallengeAdmissionError(action, 'pvp2v2'), CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON);
        }
    });

    it('keeps cleanup/recovery actions and every authoritative mode available', () => {
        for (const action of ['leave-send', 'leave-accept', 'decline', 'cancel']) {
            assert.equal(clanWarChallengeAdmissionError(action, 'pvp2v2'), null);
        }
        for (const mode of ['pvp1v1', 'pet1v1', 'pet2v2', 'tilecards']) {
            assert.equal(clanWarChallengeAdmissionError('send', mode), null);
        }
    });

    it('runs the fail-closed check before every challenge action branch', () => {
        const handler = readFileSync('api/clan/war/challenge.ts', 'utf8');
        const guard = handler.indexOf('clanWarChallengeAdmissionError(action, requestedChallengeMode)');
        const sendBranch = handler.indexOf("if (action === 'send')");
        assert.ok(guard > 0 && guard < sendBranch);
        assert.match(handler.slice(guard, sendBranch), /status: 410/);
    });
});

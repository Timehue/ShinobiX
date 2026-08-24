import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
    CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON,
    clanWarChallengeAdmissionError,
    clanWarPvp2v2Disabled,
} from './_challenge-admission.js';

const PROGRESS = ['send', 'join-send', 'accept', 'join-accept'];
const CLEANUP = ['leave-send', 'leave-accept', 'decline', 'cancel'];
const OFF = { DISABLE_CLAN_WAR_PVP_2V2: '1' } as unknown as NodeJS.ProcessEnv;
const ON = {} as unknown as NodeJS.ProcessEnv;

describe('Clan War shinobi 2v2 admission', () => {
    it('admits 2v2 progression now that a four-player lifecycle can settle it', () => {
        // The mode was fail-closed only because no engine could settle a whole
        // four-player challenge. api/clan/war/_mpvp.ts + _mpvp-settlement.ts are
        // that lifecycle, so the default state is admitted.
        assert.equal(clanWarPvp2v2Disabled(ON), false);
        for (const action of [...PROGRESS, ...CLEANUP]) {
            assert.equal(clanWarChallengeAdmissionError(action, 'pvp2v2', ON), null);
        }
    });

    it('still closes every progression path when the kill switch is set', () => {
        assert.equal(clanWarPvp2v2Disabled(OFF), true);
        for (const action of PROGRESS) {
            assert.equal(clanWarChallengeAdmissionError(action, 'pvp2v2', OFF), CLAN_WAR_PVP_2V2_UNAVAILABLE_REASON);
        }
    });

    it('never traps a retained queue record, switch set or not', () => {
        // Cleanup must survive a rollback, or a disabled mode would strand
        // whatever was already queued when it was flipped.
        for (const env of [ON, OFF]) {
            for (const action of CLEANUP) {
                assert.equal(clanWarChallengeAdmissionError(action, 'pvp2v2', env), null);
            }
        }
    });

    it('never gates a mode that owns its own lifecycle', () => {
        for (const env of [ON, OFF]) {
            for (const mode of ['pvp1v1', 'pet1v1', 'pet2v2', 'tilecards']) {
                assert.equal(clanWarChallengeAdmissionError('send', mode, env), null);
            }
        }
    });

    it('runs the admission check before every challenge action branch', () => {
        const handler = readFileSync('api/clan/war/challenge.ts', 'utf8');
        const guard = handler.indexOf('clanWarChallengeAdmissionError(action, requestedChallengeMode)');
        const sendBranch = handler.indexOf("if (action === 'send')");
        assert.ok(guard > 0 && guard < sendBranch);
        assert.match(handler.slice(guard, sendBranch), /status: 410/);
    });
});

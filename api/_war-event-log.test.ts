import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatWarEvent, warEventId } from './_war-event-log.js';

/*
 * The war-event line is what operators search during a staffed event, so its
 * shape is a contract: one JSON object after a fixed prefix, only the listed
 * fields, no player names, and the operator's event label when one is set.
 */

function parse(line: string): Record<string, unknown> {
    assert.ok(line.startsWith('[war-event] '), line);
    return JSON.parse(line.slice('[war-event] '.length)) as Record<string, unknown>;
}

describe('war-event log lines', () => {
    it('carries the kind and the listed fields, in one JSON object', () => {
        const line = formatWarEvent('battle-scored', {
            contestId: '23:moonshadowvillage-vs-frostfangvillage',
            instance: 'g1.s1700000000000',
            battleId: 'pvp-abc',
            attackerWon: true,
            points: 5,
            garrison: false,
        }, {});
        assert.equal(line.split('\n').length, 1);
        assert.deepEqual(parse(line), {
            kind: 'battle-scored',
            contestId: '23:moonshadowvillage-vs-frostfangvillage',
            instance: 'g1.s1700000000000',
            battleId: 'pvp-abc',
            attackerWon: true,
            points: 5,
            garrison: false,
        });
    });

    it('drops any field that is not listed, so a player name cannot slip in', () => {
        const fields = { battleId: 'pvp-abc', playerName: 'raider', by: 'holdout' } as never;
        const parsed = parse(formatWarEvent('battle-replayed', fields, {}));
        assert.deepEqual(parsed, { kind: 'battle-replayed', battleId: 'pvp-abc' });
    });

    it('stamps the operator\'s event label, and ignores one that is not a plain token', () => {
        assert.equal(parse(formatWarEvent('settled', { contestId: 'c' }, { WAR_EVENT_ID: 'war-2026-10-03' })).event, 'war-2026-10-03');
        assert.equal(warEventId({ WAR_EVENT_ID: 'bad label\nwith a break' }), null);
        assert.equal(warEventId({ WAR_EVENT_ID: 'x'.repeat(49) }), null);
        assert.equal(warEventId({}), null);
        assert.equal(parse(formatWarEvent('settled', { contestId: 'c' }, { WAR_EVENT_ID: 'bad label' })).event, undefined);
    });

    it('keeps a hostile value on one bounded line', () => {
        const parsed = parse(formatWarEvent('settlement-deferred', { error: `boom\r\n[war-event] {"kind":"forged"}${'x'.repeat(500)}` }, {}));
        const error = String(parsed.error);
        assert.ok(!error.includes('\n') && !error.includes('\r'));
        assert.ok(error.length <= 160);
    });

    it('writes a non-finite number as null rather than breaking the JSON', () => {
        assert.equal(parse(formatWarEvent('settled', { attackerPoints: Number.NaN }, {})).attackerPoints, null);
    });
});

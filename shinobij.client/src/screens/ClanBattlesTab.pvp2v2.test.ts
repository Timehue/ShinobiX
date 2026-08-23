import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CW_ADMITTED_CHALLENGE_MODES } from '../constants/clan';

const source = readFileSync(new URL('./ClanBattlesTab.tsx', import.meta.url), 'utf8');

/*
 * Clan War shinobi 2v2 was fail-closed while no four-player PvP lifecycle could
 * settle a whole challenge. One exists now (api/clan/war/_mpvp.ts on the Tower
 * MPvP engine, settled by _mpvp-settlement.ts), so this file locks the ADMITTED
 * behaviour instead of the retirement it used to guard.
 */
describe('Clan War shinobi 2v2 admission', () => {
    it('offers 2v2 in the challenge picker alongside every other authoritative mode', () => {
        assert.deepEqual(CW_ADMITTED_CHALLENGE_MODES, ['pvp1v1', 'pvp2v2', 'pet1v1', 'pet2v2', 'tilecards']);
        assert.match(source, /CW_ADMITTED_CHALLENGE_MODES\.map/);
    });

    it('no longer special-cases 2v2 out of the queue progression controls', () => {
        // These exclusions existed only to keep a retained record cleanup-only.
        assert.doesNotMatch(source, /ch\.mode !== "pvp2v2"/);
        assert.doesNotMatch(source, /No four-player combat authority/);
        assert.doesNotMatch(source, /Unavailable; (cancel|decline)/);
    });

    it('still routes 2v2 through the shared two-side queue, not a 1v1 accept', () => {
        // isTwoV drives the send/accept queues; pvp2v2 must remain inside it or a
        // four-player challenge could be accepted by a single defender.
        assert.ok((source.match(/ch\.mode === "pvp2v2" \|\| ch\.mode === "pet2v2"/g) ?? []).length >= 2);
    });
});

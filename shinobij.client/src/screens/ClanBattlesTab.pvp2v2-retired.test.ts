import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CW_ADMITTED_CHALLENGE_MODES } from '../constants/clan';

const source = readFileSync(new URL('./ClanBattlesTab.tsx', import.meta.url), 'utf8');

describe('Clan War shinobi 2v2 surface gap', () => {
    it('omits shinobi 2v2 from new challenge admission without hiding authoritative modes', () => {
        assert.deepEqual(CW_ADMITTED_CHALLENGE_MODES, ['pvp1v1', 'pet1v1', 'pet2v2', 'tilecards']);
        assert.match(source, /CW_ADMITTED_CHALLENGE_MODES\.map/);
        assert.match(source, /Shinobi 2v2 is unavailable until one server-owned four-player PvP lifecycle/);
    });

    it('keeps retained records cleanup-only and never offers progress or relaunch', () => {
        assert.match(source, /!isSeed && ch\.mode !== "pvp2v2"/);
        assert.ok((source.match(/ch\.mode !== "pvp2v2" && !meQueued/g) ?? []).length >= 2);
        assert.match(source, /ch\.mode === "pvp2v2"[\s\S]{0,300}No four-player combat authority/);
    });
});

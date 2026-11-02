import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stampEquippedDiscipline } from './_equipped-discipline.js';
import {
    buildPublicPlayerIndexEntry,
    needsPublicPlayerIndexBackfill,
    parsePublicPlayerIndexEntry,
    publicPlayerIndexChanged,
} from '../player/_public-index.js';

const kit = (type: unknown) => ({ id: 'mist', jutsus: [
    { type: 'Any', ap: 40, effectPower: 0, isUtility: true },
    { type, ap: 60, effectPower: 40, isUtility: false },
] });

describe('stampEquippedDiscipline', () => {
    it('publishes the equipped kit and leaves specialty alone', () => {
        const character: Record<string, unknown> = { specialty: 'Genjutsu', equippedBloodlineId: 'mist' };
        stampEquippedDiscipline(character, [kit('Bukijutsu')]);
        assert.equal(character.equippedDiscipline, 'Bukijutsu');
        assert.equal(character.specialty, 'Genjutsu');
    });

    it('drops a posted or stale value when nothing valid is equipped', () => {
        for (const [equippedBloodlineId, saved] of [['other', [kit('Bukijutsu')]], ['mist', [kit('Medical')]], [undefined, []], ['mist', 'junk']] as const) {
            const character: Record<string, unknown> = { specialty: 'Genjutsu', equippedBloodlineId, equippedDiscipline: 'Taijutsu' };
            stampEquippedDiscipline(character, saved);
            assert.equal('equippedDiscipline' in character, false);
        }
    });
});

describe('autosave', () => {
    it('stamps the stored kit over whatever the client posts, and leaves specialty', async () => {
        const { sanitizeCharacterSave } = await import('./[name].js');
        const stored = { savedBloodlines: [kit('Bukijutsu')], character: { name: 'a', specialty: 'Genjutsu', equippedBloodlineId: 'mist' } };
        const posted = { character: { name: 'a', specialty: 'Genjutsu', equippedBloodlineId: 'mist', equippedDiscipline: 'Taijutsu' } };
        const out = sanitizeCharacterSave(posted, structuredClone(stored)).character as Record<string, unknown>;
        assert.equal(out.equippedDiscipline, 'Bukijutsu');
        assert.equal(out.specialty, 'Genjutsu');
    });
});

describe('public index equipped discipline', () => {
    it('survives a row round trip and rejects a forged value', () => {
        const entry = buildPublicPlayerIndexEntry({ name: 'a', specialty: 'Genjutsu', equippedDiscipline: 'Bukijutsu' }, 'a');
        assert.equal(entry.specialty, 'Genjutsu');
        assert.equal(entry.equippedDiscipline, 'Bukijutsu');
        assert.equal(parsePublicPlayerIndexEntry(JSON.stringify(entry), 'a')?.equippedDiscipline, 'Bukijutsu');
        assert.equal('equippedDiscipline' in buildPublicPlayerIndexEntry({ name: 'a', equippedDiscipline: '<b>' }, 'a'), false);
    });

    it('counts as a change, without sending plain rows to backfill', () => {
        const before = { name: 'a', specialty: 'Genjutsu' };
        const after = buildPublicPlayerIndexEntry({ ...before, equippedDiscipline: 'Bukijutsu' }, 'a', 0, 0);
        assert.equal(publicPlayerIndexChanged(before, after), true);
        assert.equal(needsPublicPlayerIndexBackfill(buildPublicPlayerIndexEntry(before, 'a')), false);
    });
});

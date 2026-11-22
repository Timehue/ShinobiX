import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COAST_CAST, RESERVED_CAST_MODELS, coastCastMember } from './coast-cast.js';
import { QUEST_LINE_CATALOGUE } from '../api/quests/_catalog.js';
import { isNpcAccount } from './npc-village-roster.js';
import { coastSite } from './coast-world.js';
import { sectorBuilding } from './sector-buildings.js';

const MODELS = join(dirname(fileURLToPath(import.meta.url)), '..', 'shinobij.client', 'src', 'data', 'sector-models');

test('every cast member wears a world model the game already has', () => {
    for (const member of Object.values(COAST_CAST)) {
        assert.ok(existsSync(join(MODELS, `${member.model}.json`)), `${member.id}: no fitted model named ${member.model}`);
    }
});

test('no new character is given a face players know by another name', () => {
    for (const member of Object.values(COAST_CAST)) {
        assert.equal(RESERVED_CAST_MODELS.includes(member.model), false, `${member.id} wears the reserved model ${member.model}`);
    }
    // The Wandering Sage is the one existing character, and he keeps his own face.
    const existing = Object.values(COAST_CAST).filter(member => member.existing);
    assert.deepEqual(existing.map(member => [member.id, member.model]), [['wandering-sage', 'wandering-sage']]);
});

test('no two keepers share a face, and no two named characters met in one sector do', () => {
    // The people a player talks to each keep a face of their own.
    const keepers = Object.values(COAST_CAST).filter(member => member.role === 'giver' || member.role === 'keeper');
    assert.equal(new Set(keepers.map(member => member.model)).size, keepers.length);

    // A boss may wear a face seen elsewhere on the coast, never one seen in its own sector.
    const met = new Map<number, Map<string, string>>();
    const meet = (sector: number | undefined, castId: string, where: string) => {
        const member = COAST_CAST[castId];
        if (sector === undefined || !member || member.role === 'foe') return;
        const faces = met.get(sector) ?? new Map<string, string>();
        const other = faces.get(member.model);
        assert.ok(!other || other === castId, `${where}: ${castId} and ${other} share the face ${member.model} in sector ${sector}`);
        faces.set(member.model, castId);
        met.set(sector, faces);
    };
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        const first = line.stages[0];
        const offeredAt = first.kind === 'enter' ? (sectorBuilding(first.buildingId) ?? coastSite(first.buildingId))?.sector
            : first.kind === 'speak' || first.kind === 'reach' ? first.place.sector : undefined;
        if (line.giver !== 'wandering-sage') meet(offeredAt, line.giver, line.id);
    }
    for (const fight of Object.values(QUEST_LINE_CATALOGUE.fights)) meet(fight.sector, fight.castId, `fight ${fight.id}`);
});

test('names are new: not an NPC account, and none of the words the story keeps out', () => {
    const seen = new Set<string>();
    for (const member of Object.values(COAST_CAST)) {
        const key = member.name.toLowerCase();
        assert.equal(seen.has(key), false, `two cast members are called ${member.name}`);
        seen.add(key);
        if (!member.existing) assert.equal(isNpcAccount(key.replace(/[^a-z0-9]/g, '')), false, `${member.name} is a Cinderhold NPC's account name`);
        for (const text of [member.name, member.title]) {
            assert.doesNotMatch(text, /quest giver|pilgrim|adventurer|chosen one|destiny|ancient evil/i, `${member.id}: "${text}"`);
            assert.doesNotMatch(text, /[–—]|--/, `${member.id}: no dash pauses`);
        }
    }
});

test('every giver and every foe a quest names is in the cast, in a fitting role', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        const giver = coastCastMember(line.giver);
        assert.ok(giver, `${line.id}: unknown giver ${line.giver}`);
        assert.ok(giver.role === 'giver' || giver.role === 'keeper', `${line.id}: ${giver.id} cannot offer a quest`);
        for (const stage of line.stages) {
            if (stage.kind === 'speak') assert.ok(coastCastMember(stage.castId), `${line.id}/${stage.key}: unknown cast member ${stage.castId}`);
        }
    }
    for (const fight of Object.values(QUEST_LINE_CATALOGUE.fights)) {
        const foe = coastCastMember(fight.castId);
        assert.ok(foe, `fight ${fight.id}: unknown cast member ${fight.castId}`);
        // A Hold belongs to a named boss; a fight that only drops something is against rank and file.
        assert.equal(foe.role, fight.hold ? 'boss' : 'foe', `fight ${fight.id}: ${foe.id} is cast as ${foe.role}`);
    }
});

test('every cast member has a part to play', () => {
    const used = new Set<string>(['home-boatwright']); // speaks at the duty house counter; wired with the client scenes
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) used.add(line.giver);
    for (const fight of Object.values(QUEST_LINE_CATALOGUE.fights)) used.add(fight.castId);
    for (const member of Object.values(COAST_CAST)) assert.ok(used.has(member.id), `${member.id} is in the cast but in no quest`);
});

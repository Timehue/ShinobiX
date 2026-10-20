import test from 'node:test';
import assert from 'node:assert/strict';
import { PATROL_VILLAGE_VOICES, patrolGreeting, patrolNameFor, patrolStance } from './village-patrol.js';

test('a patrol answers to the village that holds its road', () => {
    assert.equal(patrolStance('', 'Leaf', []), null, 'an unclaimed road keeps the neutral patrol');
    assert.equal(patrolStance(undefined, 'Leaf', ['Mist']), null);
    assert.equal(patrolStance('Leaf', 'leaf', []), 'home', 'case-insensitive');
    assert.equal(patrolStance('Mist', 'Leaf', []), 'rival');
    assert.equal(patrolStance('Mist', 'Leaf', ['Sand']), 'rival', 'a war with someone else is not a war with the holder');
    assert.equal(patrolStance('Mist', 'Leaf', ['Mist']), 'rivalWar');
    assert.equal(patrolStance('Mist', '', ['Mist']), 'rivalWar', 'a villageless player is still an enemy of a warring holder');
});

test('each village patrol recognizes home colors and addresses the actual rival village',()=>{
    for(const owner of Object.keys(PATROL_VILLAGE_VOICES))for(const visitor of Object.keys(PATROL_VILLAGE_VOICES)) {
        const stance=patrolStance(owner,visitor,[])!;
        const line=patrolGreeting(stance,0,owner,visitor);
        if(owner===visitor) {
            assert.match(line,/one of ours/);
            for(const voice of Object.values(PATROL_VILLAGE_VOICES))assert(!line.includes(voice.jab));
        } else {
            assert.equal(line,`${PATROL_VILLAGE_VOICES[visitor].jab}. ${PATROL_VILLAGE_VOICES[owner].warning}`);
            assert.match(patrolGreeting('rivalWar',0,owner,visitor),/at war/);
        }
    }
    assert.equal(patrolGreeting('rival',0,' frostfang village ','ASHEN LEAF VILLAGE'),'Leaf Rat. Keep walking.');
    assert(!patrolGreeting('rival',0,'Frostfang Village','').includes('Leaf Rat'));
});

test('a claimed road names its patrol for the holder, and every stance has a voice', () => {
    assert.equal(patrolNameFor('Mist', 'rival', 'Storm Road Patrol'), 'Mist Patrol');
    assert.equal(patrolNameFor('', null, 'Storm Road Patrol'), 'Storm Road Patrol');
    for (const stance of ['home', 'rival', 'rivalWar'] as const) {
        for (const seed of [0, 1, 2, 7, -3]) assert.ok(patrolGreeting(stance, seed).length > 10);
    }
});

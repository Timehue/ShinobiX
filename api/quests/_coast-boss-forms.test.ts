import assert from 'node:assert/strict';
import test from 'node:test';
import { BOSS_FORM_LIMITS, validateBossTransformationPlan } from '../../shared/boss-transformations.js';
import { COAST_CAST } from '../../shared/coast-cast.js';
import { QUEST_LINE_CATALOGUE, QUEST_LINES, QUEST_LINE_FIGHTS } from './_catalog.js';
import { COAST_BOSS_FORMS } from './_coast-boss-forms.js';
import { COAST_ROUND_FIGHTS } from './_coast-rounds.js';
import { COAST_TALE_FIGHTS } from './_coast-tales.js';
import { questStageFightIds } from './_types.js';

const words = (text: string) => text.trim().split(/\s+/).length;

test('every boss that ends one of the twenty quests takes a form, and nothing lesser does', () => {
    const fights = QUEST_LINE_CATALOGUE.fights;
    const ending = new Set<string>();
    for (const line of Object.values(QUEST_LINES)) {
        // The quest's own boss is its last `boss` step (the first quest has one more step after it).
        const last = line.stages.filter(stage => stage.kind === 'boss').at(-1);
        assert.ok(last, `${line.id} has a boss`);
        if (last?.kind === 'boss') for (const id of questStageFightIds(last)) ending.add(id);
    }
    assert.equal(Object.keys(QUEST_LINES).length, 20);
    for (const id of ending) {
        assert.ok(fights[id].hold, `${id} has a Hold`);
        assert.ok(fights[id].forms, `${id} ends a quest and has no form`);
    }
    // A harder variant of the same person fights the same way.
    assert.equal(fights['quay-warden-watched'].forms, fights['quay-warden'].forms);
    // The fights on the way to a boss, the Rounds and the side tales stay as they were.
    for (const [id, fight] of Object.entries(fights)) {
        if (!fight.hold) assert.equal(fight.forms, undefined, `${id} has no Hold and must have no form`);
    }
    for (const id of [...Object.keys(COAST_ROUND_FIGHTS), ...Object.keys(COAST_TALE_FIGHTS)]) assert.equal(fights[id].forms, undefined, id);
    assert.equal(Object.values(QUEST_LINE_FIGHTS).some(fight => fight.forms), false, 'the plain table carries no plan; the catalogue joins it on');
    // No plan is written for someone nobody fights.
    const fought = new Set(Object.values(fights).filter(fight => fight.forms).map(fight => fight.castId));
    assert.deepEqual(Object.keys(COAST_BOSS_FORMS).sort(), [...fought].sort());
});

test('every plan is valid, inside the engine’s limits, and never heals', () => {
    for (const [castId, plan] of Object.entries(COAST_BOSS_FORMS)) {
        assert.deepEqual(validateBossTransformationPlan(plan), [], castId);
        assert.equal(plan.id, `coast-${castId}`);
        assert.notEqual(plan.lethalGuard, false, `${castId}: a blow that would kill still shows the form`);
        for (const phase of plan.phases) {
            const where = `${castId}/${phase.id}`;
            assert.equal(phase.healPct ?? 0, 0, `${where}: these bosses are hard enough; a form here never heals`);
            assert.equal(phase.moveset, undefined, `${where}: the kit is the level's own and is left alone`);
            for (const [key, value] of [['damageMult', phase.damageMult], ['damageTakenMult', phase.damageTakenMult]] as const) {
                if (value === undefined) continue;
                const limit = BOSS_FORM_LIMITS[key];
                assert.ok(value >= limit.min && value <= limit.max, `${where}: ${key} ${value}`);
            }
            assert.ok(phase.mechanic, `${where}: a form asks something of the player`);
        }
    }
    assert.deepEqual(COAST_BOSS_FORMS['unmoored-leader'].phases.map(phase => phase.atHpPct), [66, 33], 'the last boss changes twice');
    assert.ok(Object.entries(COAST_BOSS_FORMS).every(([castId, plan]) => castId === 'unmoored-leader' || plan.phases.length === 1));
});

test('every form is a trade: its threat comes with an opening', () => {
    for (const [castId, plan] of Object.entries(COAST_BOSS_FORMS)) {
        for (const phase of plan.phases) {
            const where = `${castId}/${phase.id}`, m = phase.mechanic!;
            if (m.kind === 'guard-stance') {
                // Tougher against most attacks, never harder-hitting, with two kinds of attack that get through.
                assert.ok((phase.damageTakenMult ?? 1) < 1 && (phase.damageMult ?? 1) <= 1, where);
                assert.ok(Array.isArray(m.weakness) && m.weakness.length === 2 && m.weaknessMult > 1, where);
                // A hit on a weakness must beat a hit on the boss before it changed, or the weakness is no opening.
                assert.ok(m.weaknessMult >= 1.25, where);
                const [element, school] = m.weakness as readonly string[];
                assert.ok(['Fire', 'Water', 'Wind', 'Earth', 'Lightning'].includes(element), `${where}: one weakness is an element`);
                assert.ok(['Ninjutsu', 'Taijutsu', 'Genjutsu', 'Bukijutsu'].includes(school), `${where}: the other is a school, so every build has a way in`);
            } else if (m.kind === 'charged-strike') {
                // Breakable by a modest hit, and breaking it pays.
                assert.ok(m.breakPct <= 6 && (m.staggerDamageTakenMult ?? 1) >= 1.25 && (phase.damageTakenMult ?? 1) >= 1.1, where);
                assert.equal(phase.damageMult, undefined, `${where}: the charge is the threat; ordinary hits are no harder`);
            } else if (m.kind === 'limit-burn') {
                // Hits harder, and pays for it in its own health. It is never tougher for burning.
                assert.ok(m.burnPct >= 2 && (phase.damageMult ?? 1) > 1 && (phase.damageTakenMult ?? 1) >= 1, where);
            } else {
                assert.fail(`${where}: ${m.kind} is not a mechanic a single-foe fight can use`);
            }
        }
    }
    const kinds = Object.values(COAST_BOSS_FORMS).flatMap(plan => plan.phases.map(phase => phase.mechanic!.kind));
    for (const kind of ['guard-stance', 'charged-strike', 'limit-burn']) assert.ok(kinds.filter(k => k === kind).length >= 5, `${kind} is used often enough to be learned`);
});

test('a form’s words follow the script’s rules and belong to the boss', () => {
    const names = new Set<string>();
    for (const [castId, plan] of Object.entries(COAST_BOSS_FORMS)) {
        const member = COAST_CAST[castId];
        assert.ok(member, `${castId} is in the cast`);
        for (const phase of plan.phases) {
            const where = `${castId}/${phase.id}`;
            // A person speaks for themselves; a beast's change is described.
            assert.ok(phase.cutscene.speaker === member.name || phase.cutscene.speaker === 'Narrator', `${where}: spoken by ${phase.cutscene.speaker}`);
            assert.equal(phase.cutscene.lines.length, 2, where);
            const said = [...phase.cutscene.lines, phase.summary, phase.mechanic!.tell, phase.formName, phase.mechanic!.name];
            for (const text of said) {
                assert.ok(words(text) <= 55, `${where}: over 55 words`);
                assert.doesNotMatch(text, /[–—]| - /, `${where}: no dash used as a pause`);
                assert.doesNotMatch(text, /\b(quest giver|pilgrim|adventurer|destiny|chosen one|ancient evil)\b/i, where);
            }
            for (const text of [...phase.cutscene.lines, phase.summary, phase.mechanic!.tell]) assert.match(text, /[.!?]$/, `${where}: a whole sentence`);
            // The numbers a player is told are the numbers the engine uses. The words carry tokens the
            // builders fill, so first: no token was left unfilled, and no figure was typed in by hand.
            const m = phase.mechanic!;
            const pct = (multiplier: number) => `${Math.round(Math.abs(multiplier - 1) * 100)}%`;
            for (const text of [phase.summary, m.tell]) assert.doesNotMatch(text, /[{}]/, `${where}: an unfilled number`);
            const told = new Set(`${phase.summary} ${m.tell}`.match(/\d+%/g) ?? []);
            const real = m.kind === 'guard-stance' ? [pct(phase.damageTakenMult!), pct(m.weaknessMult)]
                : m.kind === 'charged-strike' ? [pct(phase.damageTakenMult!), `${m.damagePct}%`, `${m.breakPct}%`]
                    : m.kind === 'limit-burn' ? [pct(phase.damageMult!), `${m.burnPct}%`] : [];
            assert.deepEqual([...told].sort(), [...new Set(real)].sort(), `${where}: told ${[...told].join(', ')}`);
            assert.ok(phase.damageMult === undefined || phase.damageMult !== 1, `${where}: a multiplier of 1 is not stated`);
            assert.equal(names.has(phase.formName), false, `${where}: a form name is used once`);
            names.add(phase.formName);
        }
    }
});

/*
 * Pins the combat resolution order (resolution-order.ts) to the engine.
 *
 * Two kinds of check:
 *   1. Source order: each step has an anchor — a line of code only that step
 *      contains — and the anchors must appear in the source in the listed
 *      order. Moving a step in the engine fails here with the step's name.
 *   2. Behaviour: a cast where the order changes the result (heals clamp at
 *      max HP), so the numbers themselves prove which order ran.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyJutsu } from '../pvp/move.js';
import type { PvpFighter } from '../pvp/session.js';
import {
    JUTSU_RESOLUTION_PHASES,
    POST_DAMAGE_ORDER,
    TURN_HANDOFF_ORDER,
    type JutsuResolutionPhase,
    type PostDamageStep,
    type TurnHandoffStep,
} from './resolution-order.js';

// Resolved from the repo root, like the other source-reading tests here: the
// server build compiles tests to CommonJS, where import.meta is unavailable.
const MOVE_SOURCE = readFileSync(join(process.cwd(), 'api', 'pvp', 'move.ts'), 'utf8');
const RESOLVE_SOURCE = readFileSync(join(process.cwd(), 'api', 'combat-core', 'resolveJutsu.ts'), 'utf8');

/** The source text of one top-level function, from its declaration to the
 *  next top-level declaration. */
function functionBody(source: string, signature: string): string {
    const start = source.indexOf(signature);
    assert.ok(start >= 0, `could not find "${signature}"`);
    const rest = source.slice(start + signature.length);
    const end = rest.search(/\n(?:export )?(?:function|const|type|interface) /);
    return rest.slice(0, end < 0 ? undefined : end);
}

function assertAnchorsInOrder<Step extends string>(body: string, order: readonly Step[], anchors: Record<Step, string>, where: string) {
    let cursor = -1;
    let previous = '(start)';
    for (const step of order) {
        const at = body.indexOf(anchors[step], cursor + 1);
        assert.ok(at >= 0, `${where}: step "${step}" (anchor ${JSON.stringify(anchors[step])}) not found after "${previous}". The engine order changed; update resolution-order.ts deliberately.`);
        cursor = at;
        previous = step;
    }
}

describe('resolution order matches the engine source', () => {
    it('resolveJutsu runs its phases in JUTSU_RESOLUTION_PHASES order', () => {
        const anchors: Record<JutsuResolutionPhase, string> = {
            resolveBaseDamage: 'phases.resolveBaseDamage(',
            resolveTagStatuses: 'phases.resolveTagStatuses(',
            resolveDamageNumber: 'phases.resolveDamageNumber(',
            damageCap: 'damageCap === undefined',
            resolvePostDamage: 'phases.resolvePostDamage(',
            applyHealing: 'phases.applyHealing(',
            applyShield: 'phases.applyShield(',
        };
        assertAnchorsInOrder(functionBody(RESOLVE_SOURCE, 'export function resolveJutsu'), JUTSU_RESOLUTION_PHASES, anchors, 'resolveJutsu');
    });

    it('resolvePostDamage applies its effects in POST_DAMAGE_ORDER', () => {
        const anchors: Record<PostDamageStep, string> = {
            shieldBlock: 'shield: Math.max(0, o.shield - blocked)',
            absorb: 'if (appliedAbsorb > 0) o =',
            itemAbsorb: 'if (appliedItemAbsorb > 0) o =',
            reflect: 'if (reflectedDmg > 0) { s =',
            itemReflect: 'if (itemReflectedDmg > 0) { s =',
            itemLifesteal: 'if (appliedItemLifeSteal > 0) { s =',
            woundAndSiphon: 'for (const tag of tags)',
            recoil: 'if (recoilStatus && finalDmg > 0)',
            lifesteal: 'if (lsPct > 0 && finalDmg > 0)',
        };
        assertAnchorsInOrder(functionBody(MOVE_SOURCE, 'function resolvePostDamage('), POST_DAMAGE_ORDER, anchors, 'resolvePostDamage');
    });

    it('Wound and Siphon both resolve inside the authored-order tag loop', () => {
        const body = functionBody(MOVE_SOURCE, 'function resolvePostDamage(');
        const loop = body.slice(body.indexOf('for (const tag of tags)'), body.indexOf('const recoilStatus'));
        assert.ok(loop.includes("tagName === 'Wound'"), 'Wound left the tag loop');
        assert.ok(loop.includes("tagName === 'Siphon'"), 'Siphon left the tag loop');
    });

    it('endTurn hands off in TURN_HANDOFF_ORDER', () => {
        const anchors: Record<TurnHandoffStep, string> = {
            applyDoTs: 'applyDoTs(endingFighter, session.round)',
            roundCapCheck: 'if (newRound > MAX_ROUNDS)',
            tickStatusesAndGround: 'tickStatuses(s.p1, session.round)',
            tickCooldowns: 'tickCooldowns(',
            applyGroundEffects: 'applyGroundEffects(s, newRound, next)',
            applyQueuedMovement: 'applyQueuedMovement(nextFighter',
            resourceRegen: 'v2ResourceRegen(',
            checkWinner: 's = checkWinner(',
            stunPenalty: 'STUN_AP_PENALTY',
        };
        assertAnchorsInOrder(functionBody(MOVE_SOURCE, 'function endTurn('), TURN_HANDOFF_ORDER, anchors, 'endTurn');
    });

    it('every listed step is unique', () => {
        for (const list of [JUTSU_RESOLUTION_PHASES, POST_DAMAGE_ORDER, TURN_HANDOFF_ORDER] as const) {
            assert.equal(new Set<string>(list).size, list.length);
        }
    });
});

function fighter(name: string, hp = 1000): PvpFighter {
    return {
        name, hp, maxHp: 1000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, shield: 0, statuses: [], pos: 0,
        character: { name, stats: {}, jutsuMastery: [] },
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jutsu(id: string, tags: Array<{ name: string; percent?: number }>): any {
    return {
        id, name: id, type: 'Ninjutsu', element: 'Fire',
        ap: 60, range: 1, effectPower: 90, cooldown: 0,
        chakraCost: 0, staminaCost: 0, target: 'OPPONENT', method: 'SINGLE', tags,
    };
}

function amountFrom(lines: string[], pattern: RegExp): { index: number; amount: number } {
    const index = lines.findIndex((l) => pattern.test(l));
    assert.ok(index >= 0, `no log line matching ${pattern}: ${JSON.stringify(lines)}`);
    return { index, amount: Number(pattern.exec(lines[index])![1]) };
}

describe('resolution order is visible in real casts', () => {
    it('Siphon heals before Recoil and Lifesteal, so a full-HP caster wastes the Siphon', () => {
        // Round 1: B puts Recoil on A; A arms a small Lifesteal on itself. Both
        // statuses become active on round 2. Recoil must outweigh Lifesteal, or
        // the caster ends at full HP whichever order runs.
        const armB = applyJutsu(fighter('B'), fighter('A'), jutsu('recoil', [{ name: 'Recoil', percent: 30 }]), 1, 'central', 1);
        const armA = applyJutsu(armB.opponent, armB.self, jutsu('lifesteal', [{ name: 'Lifesteal', percent: 15 }]), 1, 'central', 1);
        assert.ok(armA.self.statuses.some((s) => s.name === 'Recoil'), 'A should carry Recoil');
        assert.ok(armA.self.statuses.some((s) => s.name === 'Lifesteal'), 'A should carry Lifesteal');

        // Round 2: A, at full HP, casts Siphon.
        const a = { ...armA.self, hp: 1000 };
        const b = { ...armA.opponent, hp: 1000, statuses: [] };
        const r = applyJutsu(a, b, jutsu('siphon', [{ name: 'Siphon', percent: 30 }]), 1, 'central', 2);

        const siphon = amountFrom(r.lines, /^Siphon: A heals (\d+) HP/);
        const recoil = amountFrom(r.lines, /^Recoil: A takes (\d+) recoil/);
        const lifesteal = amountFrom(r.lines, /^Lifesteal: A heals (\d+) HP/);
        assert.ok(siphon.index < recoil.index && recoil.index < lifesteal.index, `log order: ${JSON.stringify(r.lines)}`);

        // Healing logs report HP actually restored, so the full-HP cast logs
        // zero Siphon. Measure its available heal with the same cast from an
        // injured state instead of treating that zero as the potential heal.
        const injured = applyJutsu({ ...a, hp: 500 }, b, jutsu('siphon', [{ name: 'Siphon', percent: 30 }]), 1, 'central', 2);
        const availableSiphon = amountFrom(injured.lines, /^Siphon: A heals (\d+) HP/).amount;
        assert.equal(siphon.amount, 0, 'Siphon is wasted before Recoil at full HP');
        assert.ok(availableSiphon > 0, 'the same Siphon must heal an injured caster');

        const cap = (hp: number) => Math.min(1000, hp);
        const pinned = cap(cap(1000 + siphon.amount) - recoil.amount + lifesteal.amount);
        const siphonLast = cap(cap(1000 - recoil.amount + lifesteal.amount) + availableSiphon);
        assert.equal(r.self.hp, pinned);
        assert.notEqual(pinned, siphonLast, 'fixture no longer distinguishes the two orders');
    });

    it('Absorb cannot revive a defender the hit already killed', () => {
        const defender: PvpFighter = {
            ...fighter('B', 100),
            statuses: [{ name: 'Absorb', rounds: 2, percent: 30, kind: 'positive', activeRound: 1 } as PvpFighter['statuses'][number]],
        };
        const r = applyJutsu(fighter('A'), defender, jutsu('hit', []), 1, 'central', 1);
        assert.equal(r.opponent.hp, 0);
    });
});

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    MAX_SERVER_AI_RULES,
    validateCreatorAiPrograms,
    validateServerAiRules,
} from './ai-authoring.js';

describe('server combat-AI authoring contract', () => {
    const fallback = { id: 'editor-only', condition: 'always', value: 99, action: 'use_basic_attack' };

    it('seals a deterministic compact program and drops editor-only ids', () => {
        const input = [
            { id: 'random-uuid', condition: 'specific_round', value: 2.9, action: 'use_specific_jutsu', jutsuId: 'fire' },
            fallback,
        ];
        const result = validateServerAiRules(input, ['fire']);
        assert.equal(result.ok, true);
        assert.deepEqual(result.rules, [
            { condition: 'specific_round', value: 2, action: 'use_specific_jutsu', jutsuId: 'fire' },
            { condition: 'always', value: 0, action: 'use_basic_attack' },
        ]);
        assert.deepEqual(result, validateServerAiRules(input, ['fire']));
    });

    it('rejects unknown vocabulary, bad references, non-finite values, and missing fallbacks', () => {
        const result = validateServerAiRules([
            { condition: 'future_condition', value: 1, action: 'use_basic_attack' },
            { condition: 'specific_round', value: Number.NaN, action: 'future_action' },
            { condition: 'always', value: 0, action: 'use_specific_jutsu', jutsuId: 'not-equipped' },
        ], ['fire']);
        assert.equal(result.ok, false);
        assert.deepEqual(result.rules, []);
        assert.ok(result.issues.some((issue) => issue.path.endsWith('.condition')));
        assert.ok(result.issues.some((issue) => issue.path.endsWith('.action')));
        assert.ok(result.issues.some((issue) => issue.path.endsWith('.jutsuId')));
        assert.ok(result.issues.some((issue) => issue.message.includes('basic-attack fallback')));
    });

    it('bounds program size and condition values', () => {
        const rules = Array.from({ length: MAX_SERVER_AI_RULES + 1 }, (_, index) => ({
            condition: index === MAX_SERVER_AI_RULES ? 'always' : 'distance_lower_than',
            value: 1_000,
            action: 'use_basic_attack',
        }));
        const result = validateServerAiRules(rules, []);
        assert.equal(result.ok, false);
        assert.ok(result.issues.some((issue) => issue.message.includes('at most')));
    });

    it('allows an omitted program and image-only built-in overrides', () => {
        assert.deepEqual(validateServerAiRules(undefined, []), { ok: true, rules: [], issues: [] });
        assert.deepEqual(validateCreatorAiPrograms([{ id: 'builtin-ai', image: 'data:image/webp;base64,x' }]), { ok: true, issues: [] });
    });

    it('validates resource, status, cooldown, recent-action, target, and Tower extension fields', () => {
        const result = validateServerAiRules([
            { condition: 'self_resource_lower_than', resource: 'chakra', value: 35, action: 'heal', target: 'self' },
            { condition: 'player_status_present', status: 'Barrier', value: 9, action: 'use_best_legal_jutsu', target: 'most_buffed' },
            { condition: 'cooldown_ready', jutsuId: 'flicker', value: 7, action: 'use_movement_jutsu', target: 'safe_ground' },
            { condition: 'player_recent_action', pattern: 'any_jutsu', value: 7, action: 'defend', target: 'self' },
            { condition: 'objective_state', state: 'contested', value: 1, action: 'hold_objective', target: 'objective_tile' },
            fallback,
        ], ['flicker']);
        assert.equal(result.ok, true);
        assert.deepEqual(result.rules[0], {
            condition: 'self_resource_lower_than', value: 35, action: 'heal', target: 'self', resource: 'chakra',
        });
        assert.deepEqual(result.rules[2], {
            condition: 'cooldown_ready', value: 0, action: 'use_movement_jutsu', jutsuId: 'flicker', target: 'safe_ground',
        });
        assert.deepEqual(result.rules[4], {
            condition: 'objective_state', value: 0, action: 'hold_objective', target: 'objective_tile', state: 'contested',
        });
    });

    it('rejects missing condition operands and impossible action targets', () => {
        const result = validateServerAiRules([
            { condition: 'self_resource_lower_than', value: 30, action: 'heal', target: 'opponent' },
            { condition: 'player_status_absent', value: 0, action: 'use_basic_attack', target: 'self' },
            { condition: 'player_recent_action', value: 0, action: 'end_turn' },
            { condition: 'cooldown_active', value: 0, action: 'use_basic_attack' },
            fallback,
        ], []);
        assert.equal(result.ok, false);
        assert.ok(result.issues.some((issue) => issue.path.endsWith('.target')));
        assert.ok(result.issues.some((issue) => issue.path.endsWith('.pattern')));
        assert.ok(result.issues.some((issue) => issue.path.endsWith('.jutsuId')));
    });

    it('reports publish issues at the creator profile path', () => {
        const result = validateCreatorAiPrograms([{
            id: 'authored',
            jutsuIds: ['fire'],
            rules: [{ condition: 'always', value: 0, action: 'use_specific_jutsu', jutsuId: 'water' }],
        }]);
        assert.equal(result.ok, false);
        assert.ok(result.issues.some((issue) => issue.path === 'creatorAis[0].rules[0].jutsuId'));
    });

    it('proves every published loadout reference exists in server content', () => {
        const result = validateCreatorAiPrograms([{
            id: 'authored',
            jutsuIds: ['known', 'missing'],
            rules: [{ condition: 'always', value: 0, action: 'use_basic_attack' }],
        }], new Set(['known']));
        assert.equal(result.ok, false);
        assert.deepEqual(result.issues, [{
            path: 'creatorAis[0].jutsuIds[1]',
            message: 'The referenced jutsu does not exist in published server content.',
        }]);
    });
});

/*
 * Runtime-neutral, server-owned combat-AI program validation.
 *
 * Creator rule ids are editor identity only, so they are intentionally not
 * sealed into combat. The compact rule program below is deterministic,
 * bounded, non-recursive, and references only jutsu already present in the
 * profile's server-sealed loadout. Engines may skip a matching rule whose
 * action is not currently legal and continue to the next rule/fallback.
 */

export const SERVER_AI_CONDITIONS = [
    'always',
    'specific_round',
    'distance_lower_than',
    'distance_higher_than',
    'hp_lower_than',
    'player_hp_lower_than',
    'player_has_shield',
    'player_has_buff',
    'player_low_ap',
    'self_has_debuff',
    'self_resource_lower_than',
    'player_resource_lower_than',
    'self_status_present',
    'self_status_absent',
    'player_status_present',
    'player_status_absent',
    'cooldown_ready',
    'cooldown_active',
    'player_recent_action',
    'ally_count_lower_than',
    'objective_state',
    'threat_higher_than',
] as const;

export const SERVER_AI_ACTIONS = [
    'use_specific_jutsu',
    'use_highest_power_jutsu',
    'use_best_legal_jutsu',
    'move_towards_opponent',
    'use_movement_jutsu',
    'use_basic_attack',
    'heal',
    'buff',
    'clear_player_buffs',
    'cleanse_self',
    'defend',
    'summon_add',
    'hold_objective',
    'end_turn',
] as const;

export const SERVER_AI_TARGETS = [
    'self',
    'opponent',
    'nearest',
    'farthest',
    'lowest_hp',
    'highest_threat',
    'support_role',
    'most_buffed',
    'most_debuffed',
    'isolated',
    'empty_ground_near_target',
    'safe_ground',
    'objective_tile',
] as const;

export const SERVER_AI_RESOURCES = ['chakra', 'stamina', 'ap'] as const;
export const SERVER_AI_RECENT_ACTIONS = [
    'any_jutsu', 'basic_attack', 'move', 'heal', 'item', 'defend', 'summon', 'flee', 'wait',
] as const;

export type ServerAiCondition = typeof SERVER_AI_CONDITIONS[number];
export type ServerAiAction = typeof SERVER_AI_ACTIONS[number];
export type ServerAiTarget = typeof SERVER_AI_TARGETS[number];
export type ServerAiResource = typeof SERVER_AI_RESOURCES[number];
export type ServerAiRecentAction = typeof SERVER_AI_RECENT_ACTIONS[number];

export type ServerAiRule = {
    condition: ServerAiCondition;
    value: number;
    action: ServerAiAction;
    jutsuId?: string;
    target?: ServerAiTarget;
    resource?: ServerAiResource;
    status?: string;
    pattern?: ServerAiRecentAction;
    state?: string;
};

export type AiProgramIssue = {
    path: string;
    message: string;
};

export type AiProgramValidation = {
    ok: boolean;
    rules: ServerAiRule[];
    issues: AiProgramIssue[];
};

export const MAX_SERVER_AI_RULES = 32;
export const MAX_SERVER_AI_LOADOUT = 8;
const MAX_AI_PROFILE_COUNT = 500;
const conditionSet = new Set<string>(SERVER_AI_CONDITIONS);
const actionSet = new Set<string>(SERVER_AI_ACTIONS);
const targetSet = new Set<string>(SERVER_AI_TARGETS);
const resourceSet = new Set<string>(SERVER_AI_RESOURCES);
const recentActionSet = new Set<string>(SERVER_AI_RECENT_ACTIONS);
const statusConditions = new Set<ServerAiCondition>([
    'self_status_present', 'self_status_absent', 'player_status_present', 'player_status_absent',
]);
const resourceConditions = new Set<ServerAiCondition>(['self_resource_lower_than', 'player_resource_lower_than']);
const cooldownConditions = new Set<ServerAiCondition>(['cooldown_ready', 'cooldown_active']);

function defaultTarget(action: ServerAiAction): ServerAiTarget {
    if (action === 'heal' || action === 'buff' || action === 'cleanse_self' || action === 'defend' || action === 'end_turn') return 'self';
    if (action === 'hold_objective') return 'objective_tile';
    if (action === 'summon_add') return 'safe_ground';
    return 'opponent';
}

function targetAllowed(action: ServerAiAction, target: ServerAiTarget): boolean {
    const selfTargets = new Set<ServerAiTarget>(['self', 'lowest_hp', 'support_role']);
    const opponentTargets = new Set<ServerAiTarget>([
        'opponent', 'nearest', 'farthest', 'lowest_hp', 'highest_threat', 'support_role',
        'most_buffed', 'most_debuffed', 'isolated',
    ]);
    const movementTargets = new Set<ServerAiTarget>([
        'opponent', 'nearest', 'farthest', 'empty_ground_near_target', 'safe_ground', 'objective_tile',
    ]);
    if (action === 'heal' || action === 'buff' || action === 'cleanse_self' || action === 'defend') return selfTargets.has(target);
    if (action === 'use_basic_attack' || action === 'clear_player_buffs') return opponentTargets.has(target);
    if (action === 'move_towards_opponent' || action === 'use_movement_jutsu') return movementTargets.has(target);
    if (action === 'hold_objective') return target === 'objective_tile';
    if (action === 'summon_add') return target === 'safe_ground' || target === 'objective_tile';
    if (action === 'end_turn') return target === 'self';
    // A sealed jutsu carries its own target contract; the runtime adapter maps
    // these selectors onto the legal actors/tiles for that combat runtime.
    return targetSet.has(target);
}

function boundedRuleValue(condition: ServerAiCondition, value: unknown): number | null {
    const number = Number(value);
    if (!Number.isFinite(number)) return condition === 'always' || condition === 'player_has_shield' ? 0 : null;
    switch (condition) {
        case 'always': case 'player_has_shield': case 'cooldown_ready': case 'cooldown_active':
        case 'player_recent_action': case 'objective_state': return 0;
        case 'specific_round': return Math.max(1, Math.min(25, Math.floor(number)));
        case 'hp_lower_than': case 'player_hp_lower_than': case 'player_low_ap':
        case 'self_resource_lower_than': case 'player_resource_lower_than': case 'threat_higher_than':
            return Math.max(0, Math.min(100, number));
        case 'player_has_buff': case 'self_has_debuff':
        case 'ally_count_lower_than':
            return Math.max(1, Math.min(32, Math.floor(number)));
        case 'self_status_present': case 'self_status_absent': case 'player_status_present': case 'player_status_absent':
            return 0;
        case 'distance_lower_than': case 'distance_higher_than':
            return Math.max(0, Math.min(120, Math.floor(number)));
    }
}

/**
 * Validate and normalize one authored rule list. An omitted/empty program is a
 * supported opt-out and lets the engine use its generic tactical policy.
 */
export function validateServerAiRules(raw: unknown, loadoutIds: readonly string[]): AiProgramValidation {
    if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) {
        return { ok: true, rules: [], issues: [] };
    }
    if (!Array.isArray(raw)) {
        return { ok: false, rules: [], issues: [{ path: 'rules', message: 'AI rules must be an array.' }] };
    }

    const issues: AiProgramIssue[] = [];
    const rules: ServerAiRule[] = [];
    const loadout = new Set(loadoutIds.filter((id) => typeof id === 'string' && id.length > 0));
    if (raw.length > MAX_SERVER_AI_RULES) {
        issues.push({ path: 'rules', message: `AI programs support at most ${MAX_SERVER_AI_RULES} rules.` });
    }

    for (let index = 0; index < Math.min(raw.length, MAX_SERVER_AI_RULES); index += 1) {
        const path = `rules[${index}]`;
        const source = raw[index];
        if (!source || typeof source !== 'object' || Array.isArray(source)) {
            issues.push({ path, message: 'Rule must be an object.' });
            continue;
        }
        const record = source as Record<string, unknown>;
        const condition = typeof record.condition === 'string' && conditionSet.has(record.condition)
            ? record.condition as ServerAiCondition
            : null;
        const action = typeof record.action === 'string' && actionSet.has(record.action)
            ? record.action as ServerAiAction
            : null;
        if (!condition) issues.push({ path: `${path}.condition`, message: 'Unknown AI condition.' });
        if (!action) issues.push({ path: `${path}.action`, message: 'Unknown AI action.' });
        if (!condition || !action) continue;

        const value = boundedRuleValue(condition, record.value);
        if (value === null) {
            issues.push({ path: `${path}.value`, message: 'Rule value must be finite.' });
            continue;
        }
        const jutsuId = typeof record.jutsuId === 'string' ? record.jutsuId.trim().slice(0, 120) : '';
        if (action === 'use_specific_jutsu' || cooldownConditions.has(condition)) {
            if (!jutsuId) {
                issues.push({ path: `${path}.jutsuId`, message: 'This rule requires a jutsu id.' });
                continue;
            }
            if (!loadout.has(jutsuId)) {
                issues.push({ path: `${path}.jutsuId`, message: 'The referenced jutsu is not in this AI loadout.' });
                continue;
            }
        }
        const target = record.target === undefined
            ? defaultTarget(action)
            : typeof record.target === 'string' && targetSet.has(record.target)
                ? record.target as ServerAiTarget
                : null;
        if (!target || !targetAllowed(action, target)) {
            issues.push({ path: `${path}.target`, message: 'The selected target is impossible for this action.' });
            continue;
        }
        const resource = typeof record.resource === 'string' && resourceSet.has(record.resource)
            ? record.resource as ServerAiResource
            : undefined;
        if (resourceConditions.has(condition) && !resource) {
            issues.push({ path: `${path}.resource`, message: 'A resource-threshold rule requires chakra, stamina, or AP.' });
            continue;
        }
        const status = typeof record.status === 'string' ? record.status.trim().slice(0, 80) : '';
        if (statusConditions.has(condition) && !status) {
            issues.push({ path: `${path}.status`, message: 'A status rule requires a status name.' });
            continue;
        }
        const pattern = typeof record.pattern === 'string' && recentActionSet.has(record.pattern)
            ? record.pattern as ServerAiRecentAction
            : undefined;
        if (condition === 'player_recent_action' && !pattern) {
            issues.push({ path: `${path}.pattern`, message: 'A recent-action rule requires a supported action pattern.' });
            continue;
        }
        const state = typeof record.state === 'string' ? record.state.trim().slice(0, 80) : '';
        if (condition === 'objective_state' && !state) {
            issues.push({ path: `${path}.state`, message: 'An objective-state rule requires a bounded state name.' });
            continue;
        }
        rules.push({
            condition,
            value,
            action,
            ...(jutsuId && (action === 'use_specific_jutsu' || cooldownConditions.has(condition)) ? { jutsuId } : {}),
            ...(record.target === undefined ? {} : { target }),
            ...(resource ? { resource } : {}),
            ...(status ? { status } : {}),
            ...(pattern ? { pattern } : {}),
            ...(state ? { state } : {}),
        });
    }

    if (raw.length > 0 && !rules.some((rule) => rule.condition === 'always')) {
        issues.push({ path: 'rules', message: 'A non-empty AI program requires an unconditional fallback.' });
    }
    if (raw.length > 0 && !rules.some((rule) => rule.condition === 'always' && rule.action === 'use_basic_attack')) {
        issues.push({ path: 'rules', message: 'A non-empty AI program requires an unconditional basic-attack fallback.' });
    }
    return { ok: issues.length === 0, rules: issues.length === 0 ? rules : [], issues };
}

/** Validate every rule program in a creatorAis publish before any field commits. */
export function validateCreatorAiPrograms(
    value: unknown,
    knownJutsuIds?: ReadonlySet<string>,
): { ok: boolean; issues: AiProgramIssue[] } {
    if (!Array.isArray(value)) {
        return { ok: false, issues: [{ path: 'creatorAis', message: 'Creator AIs must be an array.' }] };
    }
    const issues: AiProgramIssue[] = [];
    if (value.length > MAX_AI_PROFILE_COUNT) {
        issues.push({ path: 'creatorAis', message: `At most ${MAX_AI_PROFILE_COUNT} AI profiles may be published.` });
    }
    for (let index = 0; index < Math.min(value.length, MAX_AI_PROFILE_COUNT); index += 1) {
        const source = value[index];
        if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
        const profile = source as Record<string, unknown>;
        // Image-only built-in overrides deliberately have no combat program.
        if (profile.rules === undefined) continue;
        const loadoutIds = Array.isArray(profile.jutsuIds)
            ? profile.jutsuIds.filter((id): id is string => typeof id === 'string')
            : [];
        if (loadoutIds.length > MAX_SERVER_AI_LOADOUT) {
            issues.push({ path: `creatorAis[${index}].jutsuIds`, message: `AI loadouts support at most ${MAX_SERVER_AI_LOADOUT} jutsu.` });
        }
        if (knownJutsuIds) {
            for (const [jutsuIndex, id] of loadoutIds.slice(0, MAX_SERVER_AI_LOADOUT).entries()) {
                if (!knownJutsuIds.has(id)) {
                    issues.push({
                        path: `creatorAis[${index}].jutsuIds[${jutsuIndex}]`,
                        message: 'The referenced jutsu does not exist in published server content.',
                    });
                }
            }
        }
        const result = validateServerAiRules(profile.rules, loadoutIds);
        for (const issue of result.issues) {
            issues.push({ path: `creatorAis[${index}].${issue.path}`, message: issue.message });
        }
    }
    return { ok: issues.length === 0, issues };
}

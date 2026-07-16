"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HOLLOW_GATE_MAX_COMBATS_PER_FLOOR = exports.HOLLOW_GATE_COMBAT_TTL_SECONDS = void 0;
exports.hollowGateCombatBindingKey = hollowGateCombatBindingKey;
exports.isHollowGateCombatKind = isHollowGateCombatKind;
exports.normalizeHollowGateNodeId = normalizeHollowGateNodeId;
exports.hollowGateEncounterKey = hollowGateEncounterKey;
exports.hollowGateEnemyProfileId = hollowGateEnemyProfileId;
exports.createHollowGateCombatBinding = createHollowGateCombatBinding;
exports.validateHollowGateCombatSession = validateHollowGateCombatSession;
exports.settleHollowGateCombatBinding = settleHollowGateCombatBinding;
exports.hollowGatePostWinHp = hollowGatePostWinHp;
exports.hollowGateCombatReward = hollowGateCombatReward;
const node_crypto_1 = require("node:crypto");
exports.HOLLOW_GATE_COMBAT_TTL_SECONDS = 24 * 60 * 60;
exports.HOLLOW_GATE_MAX_COMBATS_PER_FLOOR = 16;
function hollowGateCombatBindingKey(runId) {
    return `hg-combat-binding:${runId}`;
}
function isHollowGateCombatKind(value) {
    return value === 'battle' || value === 'elite' || value === 'ambush' || value === 'beast' || value === 'boss';
}
function normalizeHollowGateNodeId(value) {
    const nodeId = String(value ?? '').slice(0, 96);
    return /^floor:\d{1,2}:(?:tile:\d{1,5}|ambush:[a-zA-Z0-9_-]{1,48})$/.test(nodeId) ? nodeId : '';
}
function hollowGateEncounterKey(floor, kind, nodeId) {
    return `${Math.floor(floor)}:${kind}:${nodeId}`;
}
function hollowGateEnemyProfileId(floor, kind) {
    return `hollow-gate-${kind}-f${Math.max(1, Math.floor(floor))}`;
}
function createHollowGateCombatBinding(params) {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        runId: params.runId ?? `hgcombat-${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`,
        playerName: params.playerName,
        tokenDigest: (0, node_crypto_1.createHash)('sha256').update(params.token).digest('hex'),
        floor: Math.max(1, Math.floor(params.floor)),
        nodeId: params.nodeId,
        kind: params.kind,
        enemyProfileId: hollowGateEnemyProfileId(params.floor, params.kind),
        createdAt: now,
        status: 'active',
        ...(params.secondWindArmed ? { secondWindArmed: true } : {}),
        ...(params.petAssisted ? { petAssisted: true } : {}),
    };
}
function validateHollowGateCombatSession(params) {
    const { binding, session, activeEncounter, playerName, token } = params;
    if (!binding || binding.version !== 1 || !binding.runId || !binding.nodeId)
        return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName)
        return { ok: false, reason: 'wrong-player' };
    if (binding.tokenDigest !== (0, node_crypto_1.createHash)('sha256').update(token).digest('hex'))
        return { ok: false, reason: 'wrong-token' };
    if (!session || session.runId !== binding.runId)
        return { ok: false, reason: 'wrong-run' };
    if (!activeEncounter || activeEncounter.runId !== binding.runId)
        return { ok: false, reason: 'wrong-run' };
    if (activeEncounter.nodeId !== binding.nodeId
        || activeEncounter.floor !== binding.floor
        || activeEncounter.kind !== binding.kind
        || activeEncounter.enemyProfileId !== binding.enemyProfileId) {
        return { ok: false, reason: 'binding-drift' };
    }
    if (binding.settledAt || binding.status !== 'active')
        return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done')
        return { ok: false, reason: 'not-complete' };
    if (!session.actors.some((actor) => actor.side === 'squad' && actor.ownerSlug === playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    return { ok: true, binding };
}
function settleHollowGateCombatBinding(binding, won, now = Date.now()) {
    if (binding.status !== 'active' || binding.settledAt)
        return binding;
    return { ...binding, status: won ? 'won' : 'lost', settledAt: now };
}
function hollowGatePostWinHp(maxHpRaw, survivingHpRaw, kind) {
    const maxHp = Math.max(1, Math.floor(Number(maxHpRaw) || 1));
    const survivingHp = Math.max(1, Math.floor(Number(survivingHpRaw) || 1));
    return Math.min(maxHp, survivingHp + (kind === 'boss' ? 60 : 20));
}
function hollowGateCombatReward(floorRaw, kind, profession) {
    const floor = Math.max(1, Math.min(9, Math.floor(Number(floorRaw) || 1)));
    const boss = kind === 'boss';
    const ambush = kind === 'ambush';
    const depthMult = boss ? 1 + Math.max(0, floor - 1) * 0.2 : 1;
    const baseXp = boss ? 600 : ambush ? 220 : 140;
    const baseRyo = boss ? 2400 : ambush ? 900 : 380;
    const baseDust = boss ? 30 : ambush ? 10 : 5;
    const encounterHonor = boss ? Math.floor(25 * depthMult) : 0;
    // The shipped final-clear modal paid these in addition to the boss drop.
    // Boss combat is only admitted on the sealed final floor, so bank the same
    // totals here instead of trusting a second client-side reward click.
    const clearHonor = boss ? 75 : 0;
    return {
        xp: Math.floor(baseXp * depthMult),
        ryo: Math.floor(baseRyo * depthMult),
        auraDust: Math.floor(baseDust * depthMult),
        honorSeals: profession === 'vanguard' ? encounterHonor + clearHonor : 0,
        boneCharms: (encounterHonor > 0 ? Math.max(1, Math.floor(encounterHonor / 8)) : 0)
            + (clearHonor > 0 ? Math.max(1, Math.floor(clearHonor / 8)) : 0),
        fateShards: Math.floor(encounterHonor / 25)
            + (clearHonor > 0 ? 1 + Math.floor(clearHonor / 25) : 0),
        hollowShards: boss ? 15 + floor * 5 : 0,
        fragments: boss ? 2 : 0,
        veils: boss ? 1 : 0,
    };
}

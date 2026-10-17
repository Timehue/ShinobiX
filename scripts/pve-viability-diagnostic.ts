/** Bounded ordinary-encounter viability diagnostics; no storage or combat edits.
 * Separates synthetic loadout quality, player policy, actual rolled levels and
 * starting vitals. The historical pressure matrix remains unchanged evidence.
 */
import { writeFileSync } from 'node:fs';
import { pressureFight, pressurePlayerSave, CURRENT, type Build, type Difficulty } from './pve-pressure-benchmark.js';
import { earnedForLevel, maxHpForLevel, STAT_KEYS } from '../api/_xp-engine.js';
import { aiStatBudgetForLevel } from '../api/_ai-level-curves.js';
import { ordinaryPveLevel } from '../shared/ordinary-pve-encounter.js';
import { planStandardPveEnemyActionForTest } from '../api/solo-pve/_engine.js';
import { CATALOG_CHALLENGE_WEAPON_POLICY, enemyTurnPolicy } from '../api/solo-pve/_ai-turn-policy.js';
import { policyActions } from './mission-encounter-sim.js';
import { hexDistance } from '../api/combat-core/grid.js';
import { progressiveOrdinaryAiJutsuIds, resolveAiProfileJutsu } from '../api/_ai-opponent-loadout.js';
import { pveDifficultyHpMultiplier } from '../api/_pve-difficulty.js';
import type { SoloPveAiProfile } from '../api/solo-pve/_ai-encounter.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import type { SoloPveAction, SoloPveSession } from '../api/solo-pve/_session.js';

export type DiagnosticLoadout = 'original' | 'coherent';
export type DiagnosticPolicy = 'answer' | 'planner';

/** A trainable one-discipline kit and weighted allocation, not a live-account
 * copy. Nonmaxed fixtures conserve the earned ledger within shared rank caps.
 * Common utility remains mixed-school because it does not use offensive stats.
 */
export function diagnosticPlayerSave(level: number, build: Build, loadout: DiagnosticLoadout, bloodline: 'none' | 'B' | 'A' = 'none') {
    const save = pressurePlayerSave(level, build);
    const c = save.character;
    if (bloodline !== 'none' && build !== 'maxed') {
        (c as Record<string, unknown>).equippedBloodlineId = 'benchmark-moderate-bloodline';
        (save.savedBloodlines as unknown[]) = [{ id: 'benchmark-moderate-bloodline', name: 'Benchmark Moderate Rank', rank: `${bloodline} Rank` }];
    }
    if (loadout === 'original') return save;
    c.specialty = 'Genjutsu';
    if (build !== 'maxed') {
        const statCap = statCapForLevel(level);
        const weights = Object.fromEntries(STAT_KEYS.map(key => [key, key === 'genjutsuOffense' ? 2.2
            : key === 'willpower' || key === 'intelligence' ? 1.7 : key.endsWith('Defense') ? 1.25 : 1]));
        c.stats = Object.fromEntries(STAT_KEYS.map(key => [key, 10]));
        let remaining = earnedForLevel(level);
        while (remaining > 0) {
            const active = STAT_KEYS.filter(key => c.stats[key] < statCap);
            const total = active.reduce((n, key) => n + weights[key], 0);
            let spent = 0;
            for (const key of active) {
                const amount = Math.min(statCap - c.stats[key], Math.max(0, Math.floor(remaining * weights[key] / total)));
                c.stats[key] += amount; spent += amount;
            }
            if (!spent) for (const key of active) { if (spent >= remaining) break; c.stats[key]++; spent++; }
            remaining -= spent;
        }
    }
    return save;
}

export type DurabilityProbe = 'current' | 'player-parity' | 'eighty-percent';
/** Explicit counterfactual only, never used by a production encounter. */
export function diagnosticOrdinaryProfile(profile: SoloPveAiProfile, level: number, durability: DurabilityProbe, maxDamage: number) {
    let next = { ...profile };
    if (level >= 36 && durability !== 'current') {
        next.hp = durability === 'player-parity' ? maxHpForLevel(level) / pveDifficultyHpMultiplier(level) : Number(profile.hp) * .8;
        next.armorRawDR = Math.min(Number(profile.armorRawDR), durability === 'player-parity' ? level >= 65 ? .35 : .25 : .30);
    }
    if (maxDamage < 6) {
        const ids = progressiveOrdinaryAiJutsuIds(String(profile.pveTemplateId ?? profile.id), level, String(profile.pveDifficulty));
        if (ids) {
            let damage = 0;
            const kit = resolveAiProfileJutsu(ids).filter(j => Number(j.ap) !== 60 || ++damage <= maxDamage);
            next = { ...next, jutsu: kit, rules: [] };
        }
    }
    return next;
}

export function diagnosticFixtureAudit(level: number, build: Build, loadout: DiagnosticLoadout = 'coherent', bloodline: 'none' | 'B' | 'A' = 'none') {
    const save = diagnosticPlayerSave(level, build, loadout, bloodline);
    const c = save.character;
    const gear = Object.values(c.equipment).map(id => ({ id, exists: !!ITEM_CATALOG[id], requiredLevel: effectiveItemLevelReq(ITEM_CATALOG[id]), legal: !!ITEM_CATALOG[id] && effectiveItemLevelReq(ITEM_CATALOG[id]) <= level }));
    const kit = c.equippedJutsuIds.map(id => { const j = JUTSU_CATALOG[id]; return { id, exists: !!j, element: j?.element, type: j?.type, ap: j?.ap, tags: j?.tags,
        owned: !!j && (!j.element || j.element === 'None' || c.elements.includes(j.element)) }; });
    const allocated = Object.values(c.stats).reduce((n, value) => n + Math.max(0, value - 10), 0);
    const failures = [...gear.filter(g => !g.legal).map(g => `gear:${g.id}`), ...kit.filter(j => !j.owned).map(j => `element:${j.id}`)];
    if (c.elements.length > (level < 20 ? 1 : 2)) failures.push('element-acquisition-cardinality');
    if (c.jutsuMastery.some(j => j.level > jutsuLevelCapForLevel(level))) failures.push('mastery-rank-cap');
    if (allocated > Number(c.earnedStatPoints)) failures.push('earned-ledger');
    if (Object.values(c.stats).some(value => value > statCapForLevel(level))) failures.push('stat-rank-cap');
    return { fixtureVersion: 2, level, build, loadout, bloodline, elements: c.elements, gear, kit, allocated, earnedLedger: c.earnedStatPoints,
        minimumEarnedForLevel: earnedForLevel(level), mastery: c.jutsuMastery[0].level, failures, legal: failures.length === 0 };
}

/** Human-readable competent policy: answers harmful public statuses, maintains
 * setup, uses available ranged weapon/basic attacks and closes range. It does
 * not forecast the enemy's next move or inspect hidden equipment/jutsu.
 */
export function answeringPlayerActions(s: SoloPveSession): SoloPveAction[] {
    const active = (side: 'player' | 'enemy', name: string) => s[side].statuses.some(t => t.name === name
        && t.rounds > 0 && (t.activeRound ?? 0) <= s.round && (t.inactiveRound ?? Infinity) > s.round);
    const harmful = s.player.statuses.some(t => t.kind === 'negative' && t.rounds > 0
        && (t.inactiveRound ?? Infinity) > s.round && ['Poison', 'Wound', 'Drain', 'Decrease Damage Given', 'Increase Damage Taken', 'Elemental Seal'].includes(t.name));
    const actions: SoloPveAction[] = [];
    if (harmful && !active('player', 'Cleanse Prevent')) actions.push({ type: 'cleanse' });
    if (s.player.hp < s.player.maxHp * .35) actions.push({ type: 'basicHeal' });
    if (!active('player', 'Increase Damage Given') && s.enemy.hp > s.enemy.maxHp * .15) actions.push({ type: 'jutsu', jutsuId: 'starter-gen-earth-1' });
    if (s.enemy.shield > 400 || active('enemy', 'Decrease Damage Taken') || active('enemy', 'Reflect')) actions.push({ type: 'clear' });
    const attacks = policyActions(s, 'damage');
    const basic = attacks.findIndex(a => a.type === 'basicAttack');
    const hand = (s.player.character.equipment as Record<string, string>)?.hand;
    actions.push(...attacks.slice(0, basic), ...(hand ? [{ type: 'weapon' as const, itemId: hand }] : []), ...attacks.slice(basic, -1));
    if (hexDistance(s.player.pos, s.enemy.pos) > 1) {
        for (let tile = 0; tile < 96; tile++) if (hexDistance(tile, s.enemy.pos) === 1 && hexDistance(tile, s.player.pos) <= 5)
            actions.push({ type: 'jutsu', jutsuId: 'starter-universal-flicker', tile });
    }
    if (s.player.hp < s.player.maxHp * .70) actions.push({ type: 'basicHeal' });
    actions.push({ type: 'wait' });
    return actions;
}

/** Diagnostic strong-play proxy: put the player on the existing planner's
 * acting side and use its bounded legal own-turn search. No future opponent
 * response is simulated; opponent hidden loadout is never scored. The offline
 * proxy explicitly opts the acting player's own sealed weapon into search;
 * this diagnostic-only stamp never changes a production player copy.
 */
export function plannedPlayerActions(s: SoloPveSession): SoloPveAction[] {
    const swapped = structuredClone({ ...s, events: [], log: [], player: s.enemy, enemy: s.player,
        ap: { player: s.ap.enemy, enemy: s.ap.player }, cooldowns: { player: s.cooldowns.enemy, enemy: s.cooldowns.player },
        activeSide: 'enemy', difficultyGuard: undefined, weeklyBossGuard: undefined }) as SoloPveSession;
    swapped.enemy.character.pveWeaponPolicy = CATALOG_CHALLENGE_WEAPON_POLICY;
    const action = planStandardPveEnemyActionForTest(swapped, enemyTurnPolicy(100, true)).action;
    return [...(action ? [action] : []), { type: 'wait' }];
}

async function main() {
    const opt = (key: string) => { const i = process.argv.indexOf(key); return i < 0 ? undefined : process.argv[i + 1]; };
    const rows = [];
    const levels = (opt('--levels') ?? '100').split(',').map(Number);
    const builds = (opt('--builds') ?? 'midgame,maxed').split(',') as Build[];
    const policies = (opt('--policies') ?? 'answer,planner').split(',') as DiagnosticPolicy[];
    const difficulties = (opt('--difficulties') ?? 'weaker,standard').split(',') as Difficulty[];
    const fractions = (opt('--fractions') ?? '0,0.5,0.999999').split(',').map(Number);
    const seeds = (opt('--seeds') ?? '0,2,4').split(',').map(Number);
    const paths = (opt('--paths') ?? 'explore').split(',') as Array<'explore' | 'natural'>;
    const vitals = (opt('--vitals') ?? '1').split(',').map(Number);
    const loadout = (opt('--loadout') ?? 'coherent') as DiagnosticLoadout;
    const bloodline = (opt('--bloodline') ?? 'none') as 'none' | 'A' | 'B';
    const durability = (opt('--durability') ?? 'current') as DurabilityProbe;
    const maxDamage = Number(opt('--max-damage') ?? 6);
    const sector = Number(opt('--sector') ?? 66);
    const fixtureAudit = levels.flatMap(level => builds.map(build => diagnosticFixtureAudit(level, build, loadout, bloodline)));
    if (fixtureAudit.some(f => !f.legal)) throw new Error(`Illegal diagnostic fixture: ${JSON.stringify(fixtureAudit.filter(f => !f.legal))}`);
    if (process.argv.includes('--fixtures')) {
        if (opt('--output')) writeFileSync(opt('--output')!, JSON.stringify({ fixtureVersion: 2, fixtureAudit }, null, 2) + '\n');
        console.log(JSON.stringify(fixtureAudit)); return;
    }
    for (const level of levels) for (const build of builds) for (const policy of policies) for (const difficulty of difficulties)
        for (const fraction of difficulty === 'final-kage' ? [0] : fractions) for (const seed of seeds) for (const path of paths) for (const initialVitalFraction of vitals) {
            const enemyLevel = difficulty === 'final-kage' ? 100 : ordinaryPveLevel(level, sector, difficulty, fraction);
            const row = { ...pressureFight(CURRENT, { level, build, difficulty, seed, variant: 'after', path, enemyLevel,
                save: diagnosticPlayerSave(level, build, loadout, bloodline), playerPolicy: policy === 'planner' ? plannedPlayerActions : answeringPlayerActions,
                playerPolicyName: policy, initialVitalFraction, trace: process.argv.includes('--trace'),
                ...(difficulty === 'final-kage' ? {} : { profileTransform: (profile, level) => diagnosticOrdinaryProfile(profile, level, durability, maxDamage) }) }), loadout, bloodline, durability, maxDamage, sector, fraction };
            rows.push(row);
            console.log(JSON.stringify({ level, build, policy, difficulty, seed, path, loadout, enemyLevel, initialVitalFraction,
                bloodline, durability, maxDamage, outcome: row.outcome, death: row.death, limit: row.roundLimitLoss, hp: row.finalHp, enemyHp: row.finalEnemyHp, rounds: row.rounds }));
            if (opt('--output')) writeFileSync(opt('--output')!, JSON.stringify({ diagnostic: true, fixtureVersion: 2, node: process.version, sector,
                fixtureAudit, statBudgets: levels.map(level => ({ level, playerEarned: earnedForLevel(level), legacyAiBudget: aiStatBudgetForLevel(level) })), rows }, null, 2) + '\n');
        }
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/pve-viability-diagnostic.ts')) void main();

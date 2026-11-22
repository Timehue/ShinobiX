/*
 * Fights every coast quest boss with the reference builds the story balance
 * gate uses, at the lowest level a player can meet it, through the real Solo
 * engine. The pilot plays by what is visible and throws the quest tool at a
 * standing Hold as soon as it can.
 *
 * Run it for a table:  node --import tsx scripts/coast-boss-balance-audit.ts [--no-forms]
 * The gate that reads it is scripts/coast-boss-balance.test.ts.
 */
import { pathToFileURL } from 'node:url';
import { worldRuntimeAiProfile } from '../api/missions/_world-ai-fight.js';
import { QUEST_LINE_CATALOGUE } from '../api/quests/_catalog.js';
import { questFightHolds, questStageFightIds, type QuestLineFight } from '../api/quests/_types.js';
import { buildSoloPveAiEncounter, type SoloPveAiProfile } from '../api/solo-pve/_ai-encounter.js';
import { STANDARD_PVE_AI_POLICY } from '../api/solo-pve/_ai-turn-policy.js';
import { bossHoldStands } from '../api/solo-pve/_boss-hold.js';
import { sealQuestFightKit } from '../api/solo-pve/_quest-kit.js';
import type { SoloPveSession } from '../api/solo-pve/_session.js';
import { coastCastMember } from '../shared/coast-cast.js';
import { coastBiomeOf } from '../shared/coast-world.js';
import { sectorBiomeOf } from '../shared/sector-geo.js';
import { lateStorySave } from './story-late-balance-audit.js';
import { GROUP_SCHOOLS, groupBalanceSave, pilotGroup, type GroupSchool } from './test-fixtures/narrative-group-balance.js';

export type CoastBossEntry = { questId: string; level: number; fight: QuestLineFight };

/** Every fight a quest or side tale can call for that has a Hold, with the level its quest opens at. */
export function coastBossEntries(): CoastBossEntry[] {
    const seen = new Set<string>(), out: CoastBossEntry[] = [];
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind !== 'boss' && stage.kind !== 'drop') continue;
            for (const id of questStageFightIds(stage)) {
                const fight = QUEST_LINE_CATALOGUE.fights[id];
                if (!fight?.hold || seen.has(id)) continue;
                seen.add(id);
                out.push({ questId: line.id, level: line.gate.level, fight });
            }
        }
    }
    return out;
}

/** A legal, prepared character of this level. Below the story fixture's gear level it wears the general fixture's. */
function referenceSave(level: number, school: GroupSchool, focused: boolean) {
    try { return lateStorySave(level, school, focused); } catch { return groupBalanceSave(level, school, focused, 30); }
}

/**
 * The sealed fight. `forms: false` leaves the boss's forms off, for a before and after.
 *
 * It follows api/missions/ai-fight-start.ts for the profile, the turn policy,
 * the default difficulty mode, the encounter kind and the quest kit. It is the
 * BEST case for the player in three ways, so its absolute results are
 * optimistic and only its comparisons should be leaned on: the player starts
 * on full health, chakra and stamina (a real open-world fight carries in what
 * they had), the sky is clear, and there is no admin-authored combat content.
 * A real fight is fought under the sector's weather since 2026-11-21: +5% to
 * one element and -2% to another, for both sides, on whatever sky the schedule
 * or the holding clan has put up (api/_sector-weather-seal.ts). A member of the
 * clan that holds the sector also hits 10% harder with its favoured school.
 * Neither is modelled here; both are smaller than the form differences this
 * audit compares.
 * The tool has 3 charges; a player may hold up to 9.
 *
 * `startPct` starts the boss at that share of its health, so a comparison can
 * begin where a form begins. Most reference fights end before the boss is
 * that low, and a comparison that never reaches a form says nothing about it.
 */
export function coastBossSession(entry: CoastBossEntry, school: GroupSchool, focused: boolean, forms = true, startPct?: number): SoloPveSession {
    const { fight } = entry;
    const save = referenceSave(entry.level, school, focused);
    save.currentSector = fight.sector;
    const base = worldRuntimeAiProfile(`world-questline-${entry.questId}-${fight.id}`, coastCastMember(fight.castId)?.name ?? 'Quest foe',
        Math.min(100, entry.level + fight.levelOffset), fight.statBonus, fight.loadoutId, true) as unknown as SoloPveAiProfile;
    const profile = forms && fight.forms ? { ...base, bossTransformation: fight.forms } : base;
    const session = buildSoloPveAiEncounter({
        profile, save, playerName: 'fixture', sessionId: `coast-${fight.id}-${school}-${focused ? 'f' : 'b'}`, now: 1000, admin: null,
        aiTurnPolicy: STANDARD_PVE_AI_POLICY, environment: { biome: coastBiomeOf(fight.sector) ?? sectorBiomeOf(fight.sector) },
        encounter: { kind: 'world-ai', id: 'quest-line', sourceId: entry.questId, metadata: { sector: fight.sector } },
    });
    const [first, ...rest] = questFightHolds(fight).map(hold => ({ ...hold, charges: 3 }));
    sealQuestFightKit(session, { ...first, next: rest });
    if (startPct !== undefined) session.enemy = { ...session.enemy, hp: Math.max(1, Math.floor(session.enemy.maxHp * startPct / 100)) };
    return session;
}

/**
 * Play it out with the pilot settings the late-story gate uses. The tool is
 * thrown at the Hold that stands whenever the engine allows it (a quest tool
 * is a thrown item, which the engine takes as a weapon action).
 */
export function pilotCoastBoss(session: SoloPveSession, retainLog = false) {
    return pilotGroup(session, true, retainLog, .55, true, true, false,
        live => (bossHoldStands(live) && live.bossHold ? { type: 'weapon', itemId: live.bossHold.breakerItemId } : undefined));
}

export const COAST_REFERENCE_BUILDS = GROUP_SCHOOLS.flatMap(school => [true, false].map(focused => ({ school, focused })));

export function auditCoastBoss(entry: CoastBossEntry, forms = true, startPct?: number) {
    const runs = COAST_REFERENCE_BUILDS.map(build => ({ ...build, ...pilotCoastBoss(coastBossSession(entry, build.school, build.focused, forms, startPct)) }));
    const wins = runs.filter(run => run.outcome === 'win');
    return {
        /** Per build, in COAST_REFERENCE_BUILDS order: the share of the boss still standing at the end. */
        left: runs.map(run => Math.round(1000 * Math.max(0, run.enemyHp) / run.enemyMaxHp) / 10),
        id: entry.fight.id, questId: entry.questId, level: entry.level, wins: wins.length, of: runs.length,
        schools: GROUP_SCHOOLS.filter(school => wins.some(run => run.school === school)),
        rounds: wins.length ? Math.round(wins.reduce((sum, run) => sum + run.rounds, 0) / wins.length) : 0,
        maxRounds: Math.max(...runs.map(run => run.rounds)),
        hpLeftPct: wins.length ? Math.round(100 * wins.reduce((sum, run) => sum + run.hp / run.maxHp, 0) / wins.length) : 0,
        /** How much of the boss was still standing when each fight ended, averaged over every build. 0 is a clean sweep. */
        bossLeftPct: Math.round(1000 * runs.reduce((sum, run) => sum + Math.max(0, run.enemyHp) / run.enemyMaxHp, 0) / runs.length) / 10,
        /** How many of the eight fights saw at least one form. */
        sawForm: runs.filter(run => run.formsEntered > 0).length,
        outcomes: runs.map(run => `${run.school.slice(0, 3)}${run.focused ? 'F' : 'B'}:${run.outcome === 'win' ? 'W' : run.outcome === 'loss' ? 'L' : run.outcome[0].toUpperCase()}${run.rounds}`).join(' '),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const forms = !process.argv.includes('--no-forms');
    const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
    console.log(`forms ${forms ? 'on' : 'off'}`);
    if (process.argv.includes('--from-form')) {
        // Each fight begun one point above the boss's first form, with and without forms, build by build.
        for (const entry of coastBossEntries()) {
            if (only && entry.fight.id !== only) continue;
            const start = entry.fight.forms!.phases[0].atHpPct + 1;
            const plain = auditCoastBoss(entry, false, start), formed = auditCoastBoss(entry, true, start);
            console.log(`${entry.fight.id.padEnd(24)} from ${start}%  plain ${String(plain.bossLeftPct).padStart(5)}%  formed ${String(formed.bossLeftPct).padStart(5)}%  saw ${formed.sawForm}/8 wins ${plain.wins}>${formed.wins}  worst build ${Math.max(...formed.left.map((value, i) => Math.round((value - plain.left[i]) * 10) / 10))}  ${entry.fight.forms!.phases.map(phase => phase.mechanic!.kind).join('+')}`);
        }
        process.exit(0);
    }
    for (const entry of coastBossEntries()) {
        if (only && entry.fight.id !== only) continue;
        const row = auditCoastBoss(entry, forms);
        console.log(`${row.id.padEnd(24)} L${String(row.level).padEnd(3)} wins ${row.wins}/${row.of} boss left ${String(row.bossLeftPct).padStart(5)}% saw form ${row.sawForm}/8 max rounds ${String(row.maxRounds).padEnd(2)}  ${row.outcomes}`);
    }
}

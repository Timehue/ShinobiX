/*
 * Deterministic Clan Boss balance evidence for 1/2/3/4-player geared squads.
 * This uses the shipped encounter builder, party scaling, boss mechanics, PvE
 * seals and enemy AI, with an independently audited legal catalog fixture and
 * public-state mark, pylon, Clear/Cleanse, setup and recovery responses.
 * It is an offline tuning signal, not a substitute for staging playtime data.
 *
 *   npm run audit:clan-boss-balance -- [seeds]
 */
import { CB_ASSAULT_HP_CAP, CLAN_BOSSES } from '../api/clan-boss/_storage.js';
import { configureClanBossEncounter } from '../api/clan-boss/_encounter-config.js';
import { buildTowerEncounter } from '../api/towers/_encounter.js';
import { CLAN_BOSS_FLOORS } from '../api/towers/_floor-catalog.js';
import { diagnosticPlayerSave } from './pve-viability-diagnostic.js';
import { auditPressureFixture } from './_pve-pressure-fixture-audit.js';
import { hydrateCharacterFromSave } from '../api/pvp/session.js';
import { runAuditedBossTeam } from './_pve-boss-acceptance-policy.js';
import { jutsuLevelCapForLevel } from '../api/combat-core/formulas.js';

/** Legal catalog control, independently checked through production ownership,
 * rank, resource, mastery, slot, equipment and bloodline gates. */
export function clanBossAcceptanceFixture(level = 100, build: 'maxed' | 'offense' | 'midgame' = 'maxed', sustain = true) {
    const save = diagnosticPlayerSave(level, build, 'coherent');
    save.character.equippedJutsuIds.push('starter-nin-earth-1', ...(sustain ? ['starter-nin-earth-3'] : []), 'starter-gen-earth-4', 'starter-tai-earth-2');
    const mastery = Math.min(jutsuLevelCapForLevel(level), build === 'midgame' ? 30 : build === 'offense' ? 40 : 50);
    save.character.jutsuMastery = save.character.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: mastery, xp: 0 }));
    const audit = auditPressureFixture(save, level, { ...(build === 'maxed' ? { expectedBloodlineRank: 'S Rank' } : {}), expectedMasteryCeiling: mastery });
    if (!audit.legal || audit.acquisitionWarnings.length || audit.sealedJutsuCount !== (sustain ? 12 : 11))
        throw new Error(`Illegal clan acceptance fixture: ${JSON.stringify(audit)}`);
    return { save, audit, hydrated: hydrateCharacterFromSave(save.character, {}, save, null) };
}

function acceptanceSquad(size: number, options: ClanBossBalanceOptions) {
    return Array.from({ length: size }, (_, i) => ({ id: `sq-${i}`, name: `Hero${i}`, ownerSlug: `hero${i}`, ai: false,
        character: clanBossAcceptanceFixture(options.levels?.[i] ?? 100, options.build, options.sustain).hydrated }));
}

export type ClanBossBalanceOptions = {
    levels?: number[];
    build?: 'maxed' | 'offense' | 'midgame';
    sustain?: boolean;
    bossHp?: number;
};

export type ClanBossBalanceResult = {
    bossId: string;
    partySize: number;
    seeds: number;
    clearPct: number;
    wipePct: number;
    timeoutPct: number;
    avgRounds: number;
    avgDamage: number;
    avgDamagePct: number;
    avgSurvivors: number;
    medianDamagePct: number;
    minDamagePct: number;
    maxDamagePct: number;
    avgFinalHpPct: number;
    avgMinimumHpPct: number;
    lowestHpPct: number;
    avgObservedHealing: number;
    bossHp: number;
};

export function simulateClanBossBalance(bossIndex: number, partySize: number, seeds = 12, options: ClanBossBalanceOptions = {}): ClanBossBalanceResult {
    const boss = CLAN_BOSSES[bossIndex];
    const floor = CLAN_BOSS_FLOORS[bossIndex];
    if (!boss || !floor) throw new Error(`Unknown Clan Boss index ${bossIndex}.`);
    const safeSeeds = Math.max(1, Math.min(200, Math.floor(seeds)));
    let clears = 0;
    let wipes = 0;
    let timeouts = 0;
    let rounds = 0;
    let damage = 0;
    let survivors = 0;
    const bossHp = Math.max(1, Math.floor(options.bossHp ?? CB_ASSAULT_HP_CAP));
    const damageSamples: number[] = [];
    let finalHp = 0, minimumHp = 0, lowestHp = 100, healing = 0;

    for (let index = 0; index < safeSeeds; index += 1) {
        // Match seeds across party sizes/builds; only the named scenario changes.
        const seed = 41_000 + bossIndex * 1_000 + index * 17;
        const session = buildTowerEncounter({
            floor,
            squad: acceptanceSquad(partySize, options),
            runId: `cboss-balance-${boss.id}-${partySize}-${index}`,
            seed,
            partySize,
            towerId: 'clan-boss',
            now: 0,
        });
        const bossActor = session.actors.find((actor) => actor.id === session.phaseState.bossId);
        if (!bossActor) throw new Error(`${boss.name} encounter did not create its boss actor.`);
        configureClanBossEncounter(session, floor, bossHp);
        const fight = runAuditedBossTeam(session, floor);

        const remaining = Math.max(0, bossActor.hp);
        const alive = session.actors.filter((actor) => actor.side === 'squad' && actor.hp > 0).length;
        const dealt = Math.max(0, bossHp - remaining);
        damageSamples.push(dealt / bossHp * 100);
        for (const player of fight.players) {
            finalHp += player.finalHp / player.maxHp * 100;
            minimumHp += player.minimumHp / player.maxHp * 100;
            lowestHp = Math.min(lowestHp, player.minimumHp / player.maxHp * 100);
            healing += player.hpRecoveryObservedLowerBound;
        }
        rounds += session.round;
        damage += dealt;
        survivors += alive;
        if (session.winner === 'squad') clears += 1;
        else if (alive === 0) wipes += 1;
        else timeouts += 1;
    }

    const pct = (value: number) => Math.round((value / safeSeeds) * 100);
    return {
        bossId: boss.id,
        partySize,
        seeds: safeSeeds,
        clearPct: pct(clears),
        wipePct: pct(wipes),
        timeoutPct: pct(timeouts),
        avgRounds: Math.round((rounds / safeSeeds) * 10) / 10,
        avgDamage: Math.round(damage / safeSeeds),
        avgDamagePct: Math.round((damage / safeSeeds / bossHp) * 1_000) / 10,
        avgSurvivors: Math.round((survivors / safeSeeds) * 10) / 10,
        medianDamagePct: Math.round(damageSamples.sort((a, b) => a - b).slice(Math.floor((safeSeeds - 1) / 2), Math.floor(safeSeeds / 2) + 1).reduce((sum, n, _, samples) => sum + n / samples.length, 0) * 10) / 10,
        minDamagePct: Math.round(Math.min(...damageSamples) * 10) / 10,
        maxDamagePct: Math.round(Math.max(...damageSamples) * 10) / 10,
        avgFinalHpPct: Math.round(finalHp / safeSeeds / partySize * 10) / 10,
        avgMinimumHpPct: Math.round(minimumHp / safeSeeds / partySize * 10) / 10,
        lowestHpPct: Math.round(lowestHp * 10) / 10,
        avgObservedHealing: Math.round(healing / safeSeeds / partySize),
        bossHp,
    };
}

export function runClanBossBalanceReport(argv = process.argv.slice(2)): void {
    const seeds = Math.max(1, Math.min(200, Math.floor(Number(argv[0]) || 12)));
    console.log(`\nClan Boss balance audit — geared L100 squads, ${seeds} deterministic seeds`);
    console.log(`Assault boss HP ${CB_ASSAULT_HP_CAP}; audited12-slot catalog fixture, ownedS-rank1.20, public counters and recovery.`);
    console.log('Boss                  Party  Clear  Wipe  Time  AvgRnd  AvgDamage  HP removed  Survivors');
    console.log('-'.repeat(92));
    for (let bossIndex = 0; bossIndex < CLAN_BOSSES.length; bossIndex += 1) {
        for (const partySize of [1, 2, 3, 4]) {
            const result = simulateClanBossBalance(bossIndex, partySize, seeds);
            const name = CLAN_BOSSES[bossIndex]!.name;
            console.log(
                `${name.padEnd(22)} ${String(partySize).padStart(2)}    ${String(result.clearPct).padStart(3)}%  ${String(result.wipePct).padStart(3)}%  ${String(result.timeoutPct).padStart(3)}%  ${String(result.avgRounds).padStart(6)}  ${String(result.avgDamage).padStart(9)}  ${String(result.avgDamagePct).padStart(8)}%  ${String(result.avgSurvivors).padStart(5)}`,
            );
        }
    }
    console.log('-'.repeat(92));
    console.log('Offline combat evidence only: confirm 8–15 minute human pacing and perceived fairness on disposable staging.\n');
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/clan-boss-balance-sim.ts')) runClanBossBalanceReport();

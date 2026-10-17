/*
 * Deterministic Clan Boss balance evidence for 1/2/4-player geared squads.
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

/** Legal catalog control, independently checked through production ownership,
 * rank, resource, mastery, slot, equipment and bloodline gates. */
export function clanBossAcceptanceFixture() {
    const save = diagnosticPlayerSave(100, 'maxed', 'coherent');
    save.character.equippedJutsuIds.push('starter-nin-earth-1', 'starter-nin-earth-3', 'starter-gen-earth-4', 'starter-tai-earth-2');
    save.character.jutsuMastery = save.character.equippedJutsuIds.map(jutsuId => ({ jutsuId, level: 50, xp: 0 }));
    const audit = auditPressureFixture(save, 100, { expectedBloodlineRank: 'S Rank', expectedMasteryCeiling: 50 });
    if (!audit.legal || audit.acquisitionWarnings.length || audit.sealedJutsuCount !== 12 || audit.derivedBloodlineMult !== 1.2)
        throw new Error(`Illegal clan acceptance fixture: ${JSON.stringify(audit)}`);
    return { save, audit, hydrated: hydrateCharacterFromSave(save.character, {}, save, null) };
}

function acceptanceSquad(size: number) {
    const { hydrated } = clanBossAcceptanceFixture();
    return Array.from({ length: size }, (_, i) => ({ id: `sq-${i}`, name: `Hero${i}`, ownerSlug: `hero${i}`, ai: false,
        character: structuredClone(hydrated) }));
}

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
};

export function simulateClanBossBalance(bossIndex: number, partySize: number, seeds = 12): ClanBossBalanceResult {
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

    for (let index = 0; index < safeSeeds; index += 1) {
        const seed = 41_000 + bossIndex * 1_000 + partySize * 100 + index * 17;
        const session = buildTowerEncounter({
            floor,
            squad: acceptanceSquad(partySize),
            runId: `cboss-balance-${boss.id}-${partySize}-${index}`,
            seed,
            partySize,
            now: 0,
        });
        const bossActor = session.actors.find((actor) => actor.id === session.phaseState.bossId);
        if (!bossActor) throw new Error(`${boss.name} encounter did not create its boss actor.`);
        configureClanBossEncounter(session, floor, CB_ASSAULT_HP_CAP);
        runAuditedBossTeam(session, floor);

        const remaining = Math.max(0, bossActor.hp);
        const alive = session.actors.filter((actor) => actor.side === 'squad' && actor.hp > 0).length;
        const dealt = Math.max(0, CB_ASSAULT_HP_CAP - remaining);
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
        avgDamagePct: Math.round((damage / safeSeeds / CB_ASSAULT_HP_CAP) * 1_000) / 10,
        avgSurvivors: Math.round((survivors / safeSeeds) * 10) / 10,
    };
}

export function runClanBossBalanceReport(argv = process.argv.slice(2)): void {
    const seeds = Math.max(1, Math.min(200, Math.floor(Number(argv[0]) || 12)));
    console.log(`\nClan Boss balance audit — geared L100 squads, ${seeds} deterministic seeds`);
    console.log(`Assault boss HP ${CB_ASSAULT_HP_CAP}; audited12-slot catalog fixture, ownedS-rank1.20, public counters and recovery.`);
    console.log('Boss                  Party  Clear  Wipe  Time  AvgRnd  AvgDamage  HP removed  Survivors');
    console.log('-'.repeat(92));
    for (let bossIndex = 0; bossIndex < CLAN_BOSSES.length; bossIndex += 1) {
        for (const partySize of [1, 2, 4]) {
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

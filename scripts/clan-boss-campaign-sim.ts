import { CLAN_BOSS_GUARDED_MULTIPLIER, CLAN_BOSS_OPEN_MULTIPLIER } from '../shared/clan-boss-guard.js';
/** Offline full-week campaigns. No KV, network, credentials or player writes. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { clanBossRules } from '../shared/clan-boss-rules.js';
import { CLAN_BOSSES, newClanBossProgress, reserveAttemptForRequest, bankAssault, clanBossAttemptsLeft } from '../api/clan-boss/_storage.js';
import { buildTowerEncounter } from '../api/towers/_encounter.js';
import { CLAN_BOSS_FLOORS } from '../api/towers/_floor-catalog.js';
import { configureClanBossEncounter } from '../api/clan-boss/_encounter-config.js';
import * as engine from '../api/towers/_engine.js';
import { extractAssaultResult } from '../api/clan-boss/_assault.js';
import { runAuditedBossTeam } from './_pve-boss-acceptance-policy.js';
import { campaignFighter, type CampaignProfile } from './_clan-boss-campaign-profiles.js';

export type CampaignInput = { boss: number; roster: number; partySize: number; profile: CampaignProfile | 'mixed'; seed: number; fixed?: boolean; counterplay?: boolean };
const fixtureCache = new Map<string, ReturnType<typeof campaignFighter>>();
export function simulateClanBossCampaign(input: CampaignInput) {
    const { boss, roster, partySize, profile, seed, fixed } = input;
    const floor = CLAN_BOSS_FLOORS[boss]!;
    const week = { weekId: '2026-W44', bossId: CLAN_BOSSES[boss]!.id, spawnedAt: 0, endsAt: 604800000, rulesVersion: 2 as const };
    const members = Array.from({ length: roster }, (_, i) => {
        const ratio = i / roster;
        const level = profile !== 'mixed' ? 100 : ratio < .15 ? 100 : ratio < .4 ? 85 : ratio < .8 ? 65 : 50;
        const build: CampaignProfile = profile !== 'mixed' ? profile : level === 100 ? 'sustain' : level === 85 ? 'offense' : 'midgame';
        const key = `${level}:${build}`;
        let fixture = fixtureCache.get(key);
        if (!fixture) { fixture = campaignFighter(level, build); fixtureCache.set(key, fixture); }
        return { slug: `hero${i}`, level, profile: build, fixture };
    });
    let progress = newClanBossProgress('OfflineCampaign', week, roster);
    const runs: Array<Record<string, unknown>> = [];
    let failedCommands = 0;
    while (progress.pool > 0) {
        const available = members.filter(m => (!fixed || members.indexOf(m) < partySize) && clanBossAttemptsLeft(progress, m.slug) > 0);
        if (!available.length || (fixed && available.length < partySize)) break;
        // Spread the tickets, pairing the strongest available leader with weaker members.
        available.sort((a, b) => (progress.memberAttempts[a.slug] ?? 0) - (progress.memberAttempts[b.slug] ?? 0) || b.level - a.level || a.slug.localeCompare(b.slug));
        const leader = available.shift()!;
        available.sort((a, b) => (progress.memberAttempts[a.slug] ?? 0) - (progress.memberAttempts[b.slug] ?? 0) || a.level - b.level || a.slug.localeCompare(b.slug));
        const party = [leader, ...available.slice(0, partySize - 1)];
        const slugs = party.map(m => m.slug), runSeed = seed + boss * 10000 + runs.length * 17;
        const runId = `cboss-campaign-${seed}-${boss}-${runs.length}`;
        const receipt = { requestId: `request-${runs.length}`, host: leader.slug, party: slugs, runId,
            fingerprint: JSON.stringify(slugs), seed: runSeed, bossHp: Math.min(progress.pool, clanBossRules(2).assaultHp),
            rulesVersion: 2 as const, at: runs.length + 1, poolAtStart: progress.pool, poolMax: progress.poolMax };
        const reservation = reserveAttemptForRequest(progress, receipt); assert.ok(reservation.ok);
        progress = reservation.progress;
        const squad = party.map((m, i) => ({ id: `sq-${i}`, name: m.slug, ownerSlug: m.slug, ai: false, character: structuredClone(m.fixture.hydrated) }));
        const session = buildTowerEncounter({ floor, squad, runId, seed: runSeed, partySize: party.length, towerId: 'clan-boss', clanBossRulesVersion: 2, now: receipt.at });
        configureClanBossEncounter(session, floor, receipt.bossHp, receipt);
        const actions: Record<string, number> = {};
        const auditedEngine = { ...engine, applyAction: (...args: Parameters<typeof engine.applyAction>) => {
            const result = engine.applyAction(...args);
            if (args[0] === session) {
                if (!result.applied) failedCommands++;
                else {
                    const a = args[2]; const key = a.type === 'jutsu' ? a.jutsuId : a.type;
                    actions[key] = (actions[key] ?? 0) + 1;
                    assert.ok(session.activeAp >= 0);
                    assert.ok(session.actors.every(a => a.chakra >= 0 && a.stamina >= 0));
                }
            }
            return result;
        } };
        const fight = runAuditedBossTeam(session, floor, true, auditedEngine, Object.fromEntries(party.map(m => [m.slug, m.fixture.preferred])), input.counterplay ?? false);
        const result = extractAssaultResult(session), before = progress.pool;
        progress = bankAssault(progress, { ...result, runId, by: leader.slug, party: slugs, at: receipt.at });
        runs.push({ seed: runSeed, party: slugs, levels: party.map(m => m.level), ...result, banked: before - progress.pool,
            remaining: progress.pool, survivors: fight.survivors, openings: session.clanBossGuard?.openings,
            phases: session.phaseState.triggeredPhases, actions, players: fight.players });
        assert.ok(Object.values(progress.memberAttempts).every(n => n <= 5));
        assert.ok(runs.length <= roster * 5);
    }
    assert.equal(failedCommands, 0, 'public-state policy never issues an illegal real command');
    return { ...input, bossId: week.bossId, poolMax: progress.poolMax, remaining: progress.pool,
        killed: progress.pool === 0, damage: progress.poolMax - progress.pool,
        damagePct: Math.round(1000 * (progress.poolMax - progress.pool) / progress.poolMax) / 10,
        assaults: runs.length, participantAttempts: Object.values(progress.memberAttempts).reduce((a, b) => a + b, 0),
        distinctParticipants: progress.participants.length, attempts: progress.memberAttempts,
        members: members.map(m => ({ slug: m.slug, level: m.level, profile: m.profile, audit: m.fixture.audit })), failedCommands, runs };
}

export function runCampaignReport(argv = process.argv.slice(2)) {
    const boss = Number(argv.find(a => a.startsWith('--boss='))?.slice(7) ?? 0);
    const pilot = argv.includes('--pilot');
    const counterplay = argv.includes('--counterplay');
    const mixedOnly = argv.includes('--mixed-only');
    const noSustainOnly = argv.includes('--no-sustain-only');
    const oneSize = Number(argv.find(a => a.startsWith('--size='))?.slice(7) ?? 0);
    const output = `.tmp/clan-campaign-${pilot ? 'pilot' : 'full'}-boss${boss}${noSustainOnly ? '-no-sustain' : mixedOnly ? '-mixed' : ''}${oneSize ? `-size${oneSize}` : ''}${counterplay ? '-counterplay' : ''}.json`;
    const rows: ReturnType<typeof simulateClanBossCampaign>[] = [];
    const save = (status: string) => writeFileSync(output, JSON.stringify({ status, persistentWrites: 0,
        guard: { guardedMultiplier: CLAN_BOSS_GUARDED_MULTIPLIER, openMultiplier: CLAN_BOSS_OPEN_MULTIPLIER },
        source: 'production engine + versioned reservation/bank math; synthetic legal saves; no live/staging play',
        limitations: 'Competent deterministic public-state policy; full vitals resealed as runtime; no wall-clock/network/AFK modeling. Custom bypass kits normalized by player schema and sealed from owned bloodlines. Mixed roster has 15% maxed100,25% offense85,40% midgame65,20% midgame50.', campaigns: rows }, null, 2));
    for (const seed of pilot ? [71000] : [71000, 93000]) {
        for (const profile of (noSustainOnly ? ['no-sustain'] : mixedOnly ? ['mixed'] : ['sustain', 'pierce', 'dot', 'reflection', 'offense', 'mixed']) as Array<CampaignProfile | 'mixed'>) {
            for (const size of oneSize ? [oneSize] : pilot ? [3] : [1, 2, 3, 4]) {
                const row = simulateClanBossCampaign({ boss, roster: 20, partySize: size, profile, seed, counterplay }); rows.push(row);
                const { runs, members, attempts, ...summary } = row; console.log(JSON.stringify(summary)); save('partial');
            }
            const row = simulateClanBossCampaign({ boss, roster: 20, partySize: 3, profile, seed, fixed: true, counterplay }); rows.push(row);
            const { runs, members, attempts, ...summary } = row; console.log(JSON.stringify(summary)); save('partial');
        }
        if (!pilot && !noSustainOnly) for (const roster of [3, 10]) for (const profile of ['sustain', 'mixed'] as const) {
            const row = simulateClanBossCampaign({ boss, roster, partySize: 3, profile, seed }); rows.push(row);
            const { runs, members, attempts, ...summary } = row; console.log(JSON.stringify(summary)); save('partial');
        }
    }
    save('completed');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCampaignReport();

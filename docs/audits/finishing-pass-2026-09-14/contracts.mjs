// Dated audit artifact generator. Classifications are deliberately conservative;
// UNRESOLVED is retained wherever this pass has not established shared intent.
import fs from 'node:fs';
import { RUNTIME_MODE_REGISTRY } from '../../../shared/runtime-mode-registry.ts';
const labels = { S: 'SHARED CONTRACT', I: 'INTENTIONAL MODE RULE', N: 'NOT APPLICABLE', U: 'UNRESOLVED' };
const contracts = ['entry HP', 'entry chakra', 'entry stamina', 'exit HP', 'exit chakra', 'exit stamina', 'defeat handling', 'hospital behavior', 'location after victory', 'location after defeat', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'consumable deduction', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'XP progression', 'stat growth', 'jutsu progression', 'profession progress', 'mission progress', 'Logbook progress', 'Legacy progress', 'clan contribution', 'village/war contribution', 'reward authority', 'reward settlement', 'duplicate settlement behavior', 'terminal receipt/recovery evidence'];
const profiles = {
    'solo-pve': {
        S: ['entry HP', 'exit HP', 'defeat handling', 'hospital behavior', 'consumable deduction', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'reward authority'],
        I: ['entry chakra', 'entry stamina', 'exit chakra', 'exit stamina', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'win definition', 'loss definition', 'stat growth', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['XP progression'],
        evidence: ['api/solo-pve/_ai-encounter.ts', 'api/missions/_ai-fight-outcome.ts', 'api/pve/_fight-outcome-settlement.ts', 'api/solo-pve/_usage-authority.ts', 'api/solo-pve/_store.ts', 'api/_xp-engine.ts'],
        meaning: 'Saved HP; sealed continuousVitals selects whether chakra/stamina enter and leave the fight. KO causes the shared 60-second hospital stay; surviving a timed loss is not KO. Character XP is retired; stat growth and secondary credit remain activity-specific. Active/terminal retention and automatic lapse are server-owned. Location requires caller-specific inspection, not inference from the combat engine.',
    },
    pvp: {
        S: ['consumable deduction', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'reward authority'],
        I: ['entry HP', 'entry chakra', 'entry stamina', 'exit HP', 'exit chakra', 'exit stamina', 'defeat handling', 'hospital behavior', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'win definition', 'loss definition', 'stat growth', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['XP progression'],
        evidence: ['api/pvp/session.ts', 'api/pvp/move.ts', 'api/pvp/_vitals-settlement.ts', 'api/pvp/_consumable-settlement.ts', 'api/pvp/_reward-settlement.ts', 'api/pvp/claim-rewards.ts', 'api/_receipts.ts'],
        meaning: 'Ranked/spar/arena seal fresh resources; continuous world/guard engagements carry their persistent vitals. Losing a continuous PvP duel (including AFK) admits to hospital; successful flee is the explicit exception unless KO. This is intentionally different from a surviving Solo PvE timeout. Participant/result validation and per-save atomic receipts govern payouts. Durable PvP battle history is separate from short session retention.',
    },
    tower: {
        S: ['consumable deduction', 'reward authority'],
        I: ['entry HP', 'entry chakra', 'entry stamina', 'exit HP', 'exit chakra', 'exit stamina', 'defeat handling', 'hospital behavior', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'stat growth', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['XP progression'],
        evidence: ['api/towers/_tower-session.ts', 'api/towers/_engine.ts', 'api/towers/_floor-catalog.ts', 'api/towers/_tower-store.ts', 'api/towers/settle.ts'],
        meaning: 'N-actor combat retains its own objectives, actor ownership, AFK rules and run lifecycle. First-clear Battle Tower rewards, capped assists, weekly Spire rewards and Tower-hosted competitive modes remain distinct. Consumable spend is per human and atomic with its save receipt even on a wipe. Parent orchestration can own the payout instead of Tower settlement.',
    },
    'pet-showdown': {
        S: ['reward authority'],
        I: ['entry HP', 'exit HP', 'defeat handling', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'stat growth', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['entry chakra', 'entry stamina', 'exit chakra', 'exit stamina', 'hospital behavior', 'XP progression', 'jutsu progression'],
        evidence: ['api/pet/showdown.ts', 'api/_pet-showdown/engine.ts', 'api/_pet-showdown/war-duel.ts', 'api/pet-ladder/_core.ts', 'api/first-pact/_state.ts'],
        meaning: 'Companion rosters, moves, turn scripts, reserves and defeat are mode-owned; these do not mutate the shinobi hospital or character-XP system. Paid Coliseum, practice, asynchronous Ladder, live ranked, war and First Pact have distinct reward/admission rules. Pet progression is separately recorded under the relevant value-path entry.',
    },
    'pet-warfront': {
        S: ['reward authority'],
        I: ['entry HP', 'exit HP', 'defeat handling', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'stat growth', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['entry chakra', 'entry stamina', 'exit chakra', 'exit stamina', 'hospital behavior', 'XP progression', 'jutsu progression'],
        evidence: ['api/pet/warfront-start.ts', 'api/pet/battle-result.ts', 'api/pet-ladder/_core.ts', 'api/arena/_lobby-core.ts'],
        meaning: 'Server-sealed Warfront/Rite formations, seed and rosters are distinct from turn-based Showdown and grid Gauntlet. Co-op replay does not acquire rewards merely by sharing a presentation. Old Tactical admission is retired; retained proof compatibility is separately classified.',
    },
    'pet-gauntlet-grid': {
        S: ['reward authority'],
        I: ['entry HP', 'exit HP', 'defeat handling', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'stat growth', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['entry chakra', 'entry stamina', 'exit chakra', 'exit stamina', 'hospital behavior', 'XP progression', 'jutsu progression'],
        evidence: ['api/pet/gauntlet.ts', 'api/pet/_gauntlet-entry.ts', 'api/_pet-sim/gauntlet-sim.ts'],
        meaning: 'Separate grid run/decision transcript and replay validation; no shinobi resource or hospital contract is implied. Per-run capped reward eligibility remains separate from combat presentation.',
    },
    'pet-cinematic-duel': {
        S: ['reward authority'],
        I: ['entry HP', 'exit HP', 'defeat handling', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'item/equipment interpretation', 'jutsu/loadout interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['entry chakra', 'entry stamina', 'exit chakra', 'exit stamina', 'hospital behavior', 'XP progression', 'jutsu progression'],
        evidence: ['api/pet/_duel-replay.ts', 'api/pet/battle-result.ts', 'api/_realtime/pet-duel-socket.ts', 'api/hollow-gate/_pet-authority.ts'],
        meaning: 'Live Arena PvP is memory-only and has no payout. Issued-token compatibility and Dungeon/Hollow Gate children require their own server-replayed input proof. Those parent-bound rewards cannot be inferred from cinematic playback or a different engine.',
    },
    chronicle: {
        S: ['reward authority'],
        I: ['defeat handling', 'flee handling', 'timeout handling', 'disconnect behavior', 'reconnect/resume behavior', 'item/equipment interpretation', 'cooldown/status reset behavior', 'win definition', 'loss definition', 'reward settlement', 'terminal receipt/recovery evidence'],
        N: ['entry HP', 'entry chakra', 'entry stamina', 'exit HP', 'exit chakra', 'exit stamina', 'hospital behavior', 'jutsu/loadout interpretation', 'XP progression', 'stat growth', 'jutsu progression'],
        evidence: ['api/card-clash/match.ts', 'api/card-clash/ai-move.ts', 'api/card-clash/_progression-cards.ts', 'api/card-clash/_freeplay-legacy.ts', 'api/clan/war/tilecards.ts', 'api/village/sector-card.ts'],
        meaning: 'Chronicle uses cards and board outcomes, not shinobi HP, chakra, stamina, jutsu or hospital rules. Free play, AI, Echoes, Dungeon and war integrations bind their own progression or parent settlement.',
    },
};
const commonEvidence = ['shared/runtime-mode-registry.ts', 'server-api-routes.ts'];
const rows = RUNTIME_MODE_REGISTRY.map(mode => {
    const cells = Object.fromEntries(contracts.map(c => [c, labels.U]));
    const profile = profiles[mode.authorityEngine];
    if (profile) for (const code of ['S', 'I', 'N']) for (const c of profile[code] ?? []) cells[c] = labels[code];
    if (!mode.authorityEngine) for (const c of contracts) cells[c] = labels.N;
    if (mode.rewardPolicy === 'none') {
        // A no-purse mode can still have meaningful progression (e.g. Chronicle
        // free-play Legacy, Dojo credit from a no-payout spar). Do not infer it
        // is progression-neutral from this coarse registry field.
        for (const c of ['stat growth', 'reward settlement', 'duplicate settlement behavior']) cells[c] = labels.U;
        cells['reward authority'] = labels.S; // server refuses granting value from this surface
    }
    if (mode.orchestrationOwner) for (const c of ['defeat handling', 'reward settlement', 'terminal receipt/recovery evidence']) cells[c] = labels.I;
    if (mode.id === 'academy-spar') for (const c of ['exit HP', 'exit chakra', 'exit stamina']) cells[c] = labels.I;
    if (mode.id.startsWith('clan-war-')) cells['clan contribution'] = labels.I;
    if (mode.id.startsWith('sector-war-') || mode.id === 'village-war-mercenary') cells['village/war contribution'] = labels.I;
    return { mode: mode.id, label: mode.label, authorityEngine: mode.authorityEngine, registryStatus: mode.status, availabilityCaveat: mode.statusDetail ?? 'Registry match is not deployed health certification.', cells, evidence: [...commonEvidence, ...(profile?.evidence ?? []), ...mode.routes.map(r => `api/${r.handler}.ts`)], interpretation: profile?.meaning ?? 'Retired surface or legacy owner boundary: no new gameplay inferred; see registry status detail.' };
});
// Important noncombat progression families found through mounted routes.
const additional = [
    ['dojo-circuit', 'Dojo Circuit', ['api/dojo-circuit/event.ts', 'api/dojo-circuit/_store.ts'], 'Optional event board: host-bound wins in the selected discipline and time window earn one seal. No client lifetime counter is completion proof. Pausing clears attempts.'],
    ['field-and-hunt-trails', 'Field missions and hunt trails', ['api/missions/field-trail.ts', 'api/missions/hunt-trail.ts', 'api/missions/claim-mission.ts'], 'Canonical accepted mission, movement/interaction evidence and claim state; field/hunt stat growth differs from combat-mission ryo. C1 fixes Scholars parity.'],
    ['shinobi-training', 'Stat and jutsu training', ['api/training/start.ts', 'api/training/complete.ts', 'api/training/_session.ts', 'api/training/jutsu-ryo.ts', 'api/jutsu/train-with-seals.ts'], 'Server-sealed timer and investment; changing equipment after start does not invent a new payout. Character XP remains retired.'],
    ['pet-training-and-care', 'Pet training, care and evolution', ['api/pet/progress.ts', 'api/pet/_progress.ts', 'api/pet/evolve.ts'], 'Pet XP and growth are distinct from shinobi stats; sealed timers protect completion. C2: displayed Pet Den/Yard XP bonus omitted at start.'],
    ['pet-breeding-and-sanctuary', 'Breeding, hatch, sanctuary and starter', ['api/pet/breeding-start.ts', 'api/pet/breeding-hatch.ts', 'api/pet/sanctuary-transfer.ts', 'api/pet/choose-starter.ts'], 'Server-sealed offspring/traits/palette, parent eligibility, timer and custody are separate from combat.'],
    ['expeditions-and-exploration', 'Expeditions, world exploration and chests', ['api/missions/expedition-start.ts', 'api/world/explore.ts', 'api/world/open-chest.ts'], 'Activity-specific timers/admission and server-owned loot pools; no shared combat victory assumed.'],
    ['narrative-and-events', 'Road events, interludes and built-in event claims', ['api/story/interlude.ts', 'api/story/road-event.ts', 'api/events/claim.ts', 'api/events/_claim.ts'], 'Canonical road/event identity and one-time records; user-authored event IDs do not authorize rewards.'],
    ['clan-progression', 'Clan missions, upgrades, mentorship and Exchange', ['api/clan/mission/claim.ts', 'api/clan/upgrade/purchase.ts', 'api/clan/mentor.ts', 'api/clan/exchange/purchase.ts'], 'Clan XP, treasury, War Supply and Clan Points are distinct stores; economic authority does not imply cross-key crash recovery. C3/C4 document proven interruptions.'],
    ['legacy-and-hall', 'Legacy, Sage, trials, achievements and Hall', ['api/legacy/evaluate.ts', 'api/legacy/sage.ts', 'api/legacy/trial.ts', 'api/achievements/sync.ts', 'api/hall-of-legends.ts'], 'Server-owned progress and one-time milestone/title/card entitlements; retain intentional per-activity anti-farm rules.'],
    ['village-progression', 'Village orders, agendas, upgrades, Anbu and map control', ['api/village/orders.ts', 'api/village/claim-daily-agenda.ts', 'api/village/claim-map-control.ts', 'api/village/upgrade.ts', 'api/village/anbu.ts'], 'Shared village state and individual entitlements have distinct claim identities and receipts. No change to war or economy amounts.'],
];
for (const [id, label, evidence, interpretation] of additional) {
    const cells = Object.fromEntries(contracts.map(c => [c, labels.U]));
    for (const c of ['entry HP', 'entry chakra', 'entry stamina', 'exit HP', 'exit chakra', 'exit stamina', 'defeat handling', 'hospital behavior', 'location after victory', 'location after defeat', 'flee handling', 'win definition', 'loss definition', 'cooldown/status reset behavior', 'XP progression']) cells[c] = labels.N;
    cells['reward authority'] = labels.S;
    cells['reward settlement'] = labels.I;
    rows.push({ mode: id, label, authorityEngine: 'activity-specific', registryStatus: 'additional-source-discovery', cells, evidence, interpretation });
}
const output = { auditedCommit: 'ecd8d6ccaba017a6791ec0ec94f822c10658984d', classificationLegend: labels, contracts, scope: '64 runtime-registry rows plus ten additional progression families. Engine labels describe shared engine contracts, not certification of every orchestrator. Entry/exit resources are combat resources; XP means shinobi XP (retired), pet/profession XP is separately inventoried. Secondary progress, caller location and incomplete proof remain UNRESOLVED; no defect is inferred from that label.', rows };
fs.writeFileSync(new URL('./contract-matrix.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(`${rows.length} modes × ${contracts.length} contracts; all cells use one permitted classification.`);

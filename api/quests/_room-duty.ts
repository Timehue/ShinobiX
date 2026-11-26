import { COAST_WATCHES } from '../../shared/coast-watch.js';
import type { AtomicSaveTransaction } from '../save/_commit-player-save.js';
import { coastSite } from '../../shared/coast-world.js';
import { canAdjustBench, dutyAnswer, dutyOrder, validBenchSample, roomDuties, type RoomDutyProgress } from '../../shared/coast-room-duties.js';
import { addOwned } from '../craft/_forge.js';
import { CAFETERIA_MEALS, applyCafeteriaMeal } from '../player/_cafeteria.js';
import { onlineStore } from '../_realtime/online-store.js';
import { resourceBattleActive } from '../world/_resource-battle.js';
import { sectorPositionModel } from '../_coast-walk-space.js';
import { battleLockKey } from '../_elapsed-state.js';
import { kv } from '../_storage.js';
import type { PlayerSaveMutation, PlayerSaveMutationContext } from '../save/_mutate-player-save.js';
import { questLinesForStorage, type QuestLinesRecord } from './_record.js';

type Reply = { body: Record<string, unknown>; wrote: boolean };

function workbenchFeedback(site: string, expected: string | number, sample: unknown): string {
    if (typeof expected === 'number' && typeof sample === 'number' && Number.isInteger(sample) && Math.abs(sample) <= 3) {
        if (site === 'saltstair-houses-105') return sample > expected
            ? 'The salt catches at the back of your throat. Stir in plain stock and taste again.'
            : 'The broth tastes watery. Add brine and taste again.';
        if (site === 'saltstair-dock-101') return sample > expected
            ? 'The plank rocks on the high spot. Plane off a shaving and try the fit again.'
            : 'Light still shows under the plank. Add a shim and try the fit again.';
    }
    if (site === 'hushcrown-fort-148' && typeof expected === 'string' && typeof sample === 'string' && /^(Flash|Hold)( (Flash|Hold)){2}$/.test(sample)) {
        const pulses = sample.split(' ');
        const missed = expected.split(' ').findIndex((pulse, index) => pulse !== pulses[index]);
        return 'The far post repeats the ' + ['first', 'second', 'third'][missed] + ' beat. Check that beat against the disk and send the call again.';
    }
    return 'That does not match your reading. Check it again and retry.';
}

export async function roomDutyAction(ctx: PlayerSaveMutationContext, record: QuestLinesRecord, site: string,
    body: Record<string, unknown>): Promise<PlayerSaveMutation<Reply>> {
    const duty = Object.hasOwn(roomDuties, site) && roomDuties[site];
    const building = coastSite(site);
    if (!duty || !building) return { ok: false, status: 400, error: 'Unknown building job.' };
    const ledger = { ...record.roomDuties };
    let changed = false;
    let atomicProof: AtomicSaveTransaction | undefined;
    let character = ctx.character;
    function result(): PlayerSaveMutation<Reply> {
        return { ok: true, character, write: changed, atomicProof,
            ...(changed ? { recordPatch: { questLines: questLinesForStorage({ ...record, roomDuties: ledger }, ctx.record.questLines) } } : {}),
            value: { body: { ok: true, progress: ledger[site] ?? { tick: 0 } }, wrote: changed } };
    }
    if (body.command === 'sync') {
        // Import old notebooks once per building. Historical completions carry
        // notes and readings only. A paid receipt can only come from delivery.
        const old = body.legacy;
        if (old && typeof old === 'object' && !Array.isArray(old)) {
            for (const id of Object.keys(roomDuties)) {
                const tick = (old as Record<string, unknown>)[id];
                if (!ledger[id] && typeof tick === 'number' && Number.isSafeInteger(tick) && tick > 0 && tick <= 2 ** 31 && tick % 4 !== 0) {
                    ledger[id] = { tick };
                    changed = true;
                }
            }
        }
        return result();
    }
    const tick = ledger[site]?.tick ?? 0;
    if (typeof body.tick !== 'number' || !Number.isSafeInteger(body.tick) || body.tick < 0 || body.tick > tick)
        return { ok: false, status: 409, error: 'Reopen the job to read your current request.' };
    if (body.tick < tick) return result(); // Another device or a retry already performed this step.
    const now = Date.now(), presence = onlineStore.get(ctx.playerName);
    if (!presence || presence.locationUnverified || presence.inBattle || character.hospitalized ||
        (presence.travelingUntil ?? 0) > now || now - presence.lastSeenAt > 30_000 ||
        presence.sector !== building.sector)
        return { ok: false, status: 409, error: 'Return to the building to continue the request.' };
    const model = sectorPositionModel(building.sector);
    const position = model.read(presence.worldPosition) ?? model.fallback(presence.sector, presence.tile ?? -1);
    const entrance = model.fallback(building.sector, building.approach);
    if (!position || !entrance || model.distanceWithin(position, entrance, 1) === null)
        return { ok: false, status: 409, error: 'Return to the building to continue the request.' };
    const stage = tick % 4;
    const current = ledger[site] ?? { tick: 0 };
    const order = dutyOrder(duty, current);
    const sample = current.bench?.value ?? (typeof duty.cases[order].answer === 'number' ? 0 : '');
    let next: RoomDutyProgress;
    if (body.command === 'take' && (stage === 0 || stage === 3)) {
        next = stage === 3 ? { tick: tick + 2, order: (order + 1) % duty.cases.length } : { tick: 1 };
    } else if (body.command === 'inspect' && stage === 1 && body.station === duty.inspect) {
        next = { ...current, tick: tick + 1 };
    } else if (body.command === 'adjust' && stage === 2 && body.station === duty.operate) {
        if (!validBenchSample(duty, body.answer)) return { ok: false, status: 400, error: 'That sample does not belong at this bench.' };
        const revision = current.bench?.revision ?? 0;
        if (body.revision !== revision) return result();
        if (sample === body.answer) return result();
        if (!canAdjustBench(duty, sample, body.answer)) return { ok: false, status: 409, error: 'Make one adjustment to your current sample at a time.' };
        next = { ...current, bench: { tick, value: body.answer, revision: revision + 1 } };
    } else if (body.command === 'deliver' && stage === 2 && body.station === duty.operate) {
        if (body.revision !== undefined && body.revision !== (current.bench?.revision ?? 0)) return result();
        const card = duty.cases[order];
        // Clients already open during a release may still show a one-button fitting.
        const legacyBench = body.revision === undefined && !current.bench;
        const answer = card.fitting && legacyBench && body.answer === card.action ? card.action : dutyAnswer(card);
        if (!legacyBench && validBenchSample(duty, answer) && body.answer !== sample)
            return { ok: false, status: 409, error: 'Check the sample on your bench before handing it in.' };
        if (card.fitting && body.answer !== answer && typeof body.answer === 'string') {
            const pieceMatches = body.answer.split('|')[0] === card.fitting[0];
            return { ok: false, status: 409, error: pieceMatches ? 'That piece fits the order. Check where it needs to go.' : 'Check the load or material in your reading, then pick the piece again.' };
        }
        if (body.answer !== answer) return { ok: false, status: 409, error: workbenchFeedback(site, answer, body.answer) };
        if (await kv.get(battleLockKey(ctx.playerName)) || await resourceBattleActive(ctx.playerName))
            return { ok: false, status: 409, error: 'Finish your battle before handing in the work.' };
        if (duty.reward.meal) {
            const meal = applyCafeteriaMeal(character, { ...CAFETERIA_MEALS['small-ramen'], cost: 0 });
            if (!meal.ok) return { ok: false, status: 409, error: meal.error };
            character = meal.character;
        }
        if (Object.hasOwn(COAST_WATCHES, site)) {
            const key = 'world:coast-watch:' + site;
            const value = { order };
            atomicProof = { key, expected: (await kv.get(key)) ?? null, value, rebase: () => value };
        }
        character = addOwned(character, duty.reward.item, duty.reward.quantity, true);
        next = { tick: tick + 1, paidTick: tick + 1, ...(current.order !== undefined ? { order } : {}) };
    } else return { ok: false, status: 409, error: 'Follow the current request and visit its marked station.' };
    ledger[site] = next;
    changed = true;
    return result();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { PET_CATALOG } from '../pet/_catalog.js';
import { beginChampionshipRace, checkpointChampionship, prepareChampionship, rallyProgress } from './_rally.js';
import { caravanProgress, departCaravan, finishCaravan } from './_caravan.js';
import { rallyResult } from '../../shared/sunscar/rally-simulation.js';
import { brokerCertificateCount } from '../../shared/sunscar/broker-certificates.js';

const now = Date.UTC(2026, 9, 18, 12);
const player = () => ({ name: 'racer', level: 30, ryo: 1000, brokerCertificates: 3,
    hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
    pets: [{ ...PET_CATALOG['starter-fire'], id: 'my-fire', templateId: 'starter-fire' }] });

test('verified championship awards 2/1/0/0 certificates by final place, exactly once', () => {
    for (const [place, expected] of [[1, 2], [2, 1], [3, 0], [4, 0]]) {
        let character = prepareChampionship(player(), 'racer', 'my-fire', now);
        const id = rallyProgress(character).current!.id;
        character = beginChampionshipRace(character, id, now);
        assert.equal(brokerCertificateCount(character), 3, 'entry awards nothing');
        // Seed stored race finishes immediately before the final verified checkpoint.
        const progress = rallyProgress(character), run = progress.current!;
        const race = run.race!;
        const order = race.racers.filter(r => r.id !== 'player');
        order.splice(place - 1, 0, race.racers[0]);
        order.forEach((racer, index) => { racer.finishTick = index + 1; });
        const result = rallyResult({ ...race, finished: true });
        run.results = [structuredClone(result), structuredClone(result)];
        run.raceIndex = 2;
        character = { ...character, sunscarRally: progress };
        const body = { runId: id, raceIndex: 2, fromTick: 0, toTick: 300, actions: [] };
        const settled = checkpointChampionship(character, body, now + 5000).character;
        const reward = rallyProgress(settled).current!.reward!;
        assert.equal(reward.place, place);
        assert.equal(reward.brokerCertificates, expected);
        assert.equal(brokerCertificateCount(settled), 3 + expected);
        const replay = checkpointChampionship(settled, body, now + 6000);
        assert.equal(replay.replay, true);
        assert.deepEqual(replay.character, settled);
    }
});

test('a successful Caravan delivery grants one certificate even without the bonus objective; failure grants none', () => {
    for (const success of [true, false]) {
        const character = departCaravan(player(), 'racer', { contractId: 'market-goods', tools: ['water', 'repair', 'medicine'] }, now);
        const progress = caravanProgress(character);
        progress.current!.cargo = 1;
        const settled = finishCaravan(character, progress, 'Test delivery', success, now + 1000);
        assert.equal(caravanProgress(settled).current!.result!.objectiveComplete, false);
        assert.equal(caravanProgress(settled).current!.result!.brokerCertificates, success ? 1 : 0);
        assert.equal(brokerCertificateCount(settled), success ? 4 : 3);
        assert.deepEqual(finishCaravan(settled, caravanProgress(settled), 'Retry', success, now + 2000), settled);
    }
});

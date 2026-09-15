import { randomUUID } from 'node:crypto';
import { PET_CATALOG } from '../pet/_catalog.js';
import { resolvePetTemplateId } from '../pet/_owned-pet.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { grantFestivalTitles } from './_prestige.js';
import { dailyLoginRyo } from '../player/_daily-login.js';
import { sunscarHash, sunscarShuffle } from '../../shared/sunscar/random.js';
import { rallyProfile } from '../../shared/sunscar/rally-profiles.js';
import { RALLY_RIVALS } from '../../shared/sunscar/rally-rivals.js';
import { RALLY_TRACKS } from '../../shared/sunscar/rally-tracks.js';
import { createRallyRace, rallyResult, replayRallyCheckpoint } from '../../shared/sunscar/rally-simulation.js';
import { RALLY_HZ, type RallyElement, type RallyPet } from '../../shared/sunscar/rally-types.js';
import { rallyStandings, type RallyChampionship, type RallyProgress } from '../../shared/sunscar/rally-championship.js';

type Obj = Record<string, unknown>;
export class FestivalError extends Error {
    constructor(message: string, public status = 400) { super(message); }
}
export const festivalDay = (now: number): string => new Date(now).toISOString().slice(0, 10);
export function rallyProgress(character: Obj): RallyProgress {
    const raw = character.sunscarRally as RallyProgress | undefined;
    return raw ? structuredClone(raw) : { reputation: 0, championships: 0, wins: 0, lastEntryDay: null, current: null, best: {} };
}
function catalogRallyPet(templateId: string, owned?: Obj): RallyPet {
    const catalog = PET_CATALOG[templateId];
    if (!catalog || !['Fire', 'Water', 'Earth', 'Wind', 'Lightning'].includes(String(catalog.element))) throw new FestivalError('This companion is not eligible for the Rally.');
    return {
        id: String(owned?.id ?? templateId), templateId, name: String(owned?.nickname || catalog.name), element: catalog.element as RallyElement,
        profile: rallyProfile({ id: templateId, name: String(catalog.name) }), rarity: String(catalog.rarity),
        ...(typeof owned?.evolutionStage === 'number' ? { evolutionStage: owned.evolutionStage } : {}),
        ...(typeof owned?.paletteVariantId === 'string' ? { paletteVariantId: owned.paletteVariantId } : {}),
    };
}
export function ownedRallyPet(character: Obj, id: unknown): RallyPet {
    const pets = Array.isArray(character.pets) ? character.pets as Obj[] : [];
    const pet = pets.find(entry => entry.id === id);
    if (!pet) throw new FestivalError('Choose a pet from your own companions.');
    if (petCombatBusyReason(character, pet)) throw new FestivalError('This companion is busy. Choose an available pet.');
    const template = resolvePetTemplateId(pet);
    if (!template) throw new FestivalError('This companion has no registered race profile.');
    return catalogRallyPet(template, pet);
}
export function makeRallyEntrants(pet: RallyPet, rivals: string[]) {
    return [{ id: 'player', pet, rivalId: null as string | null }, ...rivals.map(id => {
        const rival = RALLY_RIVALS.find(r => r.id === id);
        if (!rival) throw new FestivalError('Rival roster is unavailable.', 503);
        return { id, pet: { ...catalogRallyPet(rival.petId), name: rival.petName }, rivalId: id };
    })];
}
export function rallyDaily(player: string, now: number) {
    const day = festivalDay(now);
    const seed = sunscarHash(`sunscar-gp-v1:${day}:${player}`);
    return { day, seed, tracks: sunscarShuffle(RALLY_TRACKS.map(t => t.id), seed).slice(0, 3), rivals: sunscarShuffle(RALLY_RIVALS.map(r => r.id), seed ^ 7245).slice(0, 3) };
}
export function prepareChampionship(character: Obj, player: string, petId: unknown, now: number): Obj {
    const progress = rallyProgress(character);
    if (progress.current && (['racing', 'between'].includes(progress.current.status) || progress.current.results.length > 0 && progress.current.status !== 'complete')) throw new FestivalError('Resume your current Grand Prix.', 409);
    if (progress.lastEntryDay === festivalDay(now)) throw new FestivalError('Your daily Grand Prix is complete. Practice is always open.', 409);
    const pet = ownedRallyPet(character, petId);
    const daily = rallyDaily(player, now);
    progress.current = {
        id: randomUUID(), ...daily, pet, difficulty: Math.min(3, Math.floor(progress.reputation / 300)),
        raceIndex: 0, race: null, startedAt: null, checkpointAt: now, results: [], status: 'ready', reward: null,
        // Full championship pays 30–50% of the actual daily-login curve. No shards or combat stats.
        rewardBase: Math.round(dailyLoginRyo(Number(character.level) || 1) * .5),
    };
    return { ...character, sunscarRally: progress };
}
export function requireChampionship(progress: RallyProgress, id: unknown): RallyChampionship {
    if (!progress.current || progress.current.id !== id) throw new FestivalError('This Grand Prix changed. Reload the race desk.', 409);
    return progress.current;
}
export function beginChampionshipRace(character: Obj, id: unknown, now: number): Obj {
    const progress = rallyProgress(character);
    const run = requireChampionship(progress, id);
    if (run.status === 'racing') return character;
    if (run.status !== 'ready' && run.status !== 'between') throw new FestivalError('This Grand Prix has already finished.', 409);
    if (run.results.length === 0) {
        // Preparing/loading costs no attempt. A stale unstarted reservation rolls forward.
        if (run.day !== festivalDay(now)) throw new FestivalError('A new festival day has begun. Choose your pet again.', 409);
        ownedRallyPet(character, run.pet.id);
        if (progress.lastEntryDay === run.day) throw new FestivalError('You have already entered today.', 409);
        progress.lastEntryDay = run.day;
    }
    run.raceIndex = run.results.length;
    run.race = createRallyRace(run.seed + run.raceIndex, run.tracks[run.raceIndex], makeRallyEntrants(run.pet, run.rivals));
    run.status = 'racing';
    run.startedAt = now;
    run.checkpointAt = now;
    return { ...character, sunscarRally: progress };
}
export function checkpointChampionship(character: Obj, body: Obj, now: number): { character: Obj; paid: number; replay: boolean } {
    const progress = rallyProgress(character);
    const run = requireChampionship(progress, body.runId);
    if (!Number.isInteger(body.raceIndex) || body.raceIndex !== run.raceIndex) throw new FestivalError('This is not the active championship race.', 409);
    if (!run.race) throw new FestivalError('Start the race before submitting inputs.', 409);
    const to = Number(body.toTick);
    if (!Number.isInteger(to) || to < 1) throw new FestivalError('Invalid race checkpoint.');
    if (to <= run.race.tick || run.status === 'complete' || run.status === 'between') return { character, paid: 0, replay: true };
    if (Number(body.fromTick) !== run.race.tick) throw new FestivalError('Another checkpoint was saved. Resume from the race desk.', 409);
    if (run.startedAt === null || to / RALLY_HZ > (now - run.startedAt) / 1000 + 2) throw new FestivalError('Race inputs are ahead of the official clock. Wait and retry.', 409);
    try { run.race = replayRallyCheckpoint(run.race, to, body.actions, run.difficulty); }
    catch { throw new FestivalError('The checkpoint contains invalid race inputs.'); }
    run.checkpointAt = now;
    let paid = 0;
    if (run.race.finished) {
        const result = rallyResult(run.race);
        run.results.push(result);
        const player = result.placements.find(r => r.id === 'player')!;
        progress.best[result.trackId] = Math.min(progress.best[result.trackId] ?? Infinity, player.tick);
        if (run.results.length < 3) run.status = 'between';
        else {
            const standings = rallyStandings(run.results);
            const place = standings.findIndex(r => r.id === 'player') + 1;
            const reputation = standings.find(r => r.id === 'player')!.points;
            paid = Math.floor(run.rewardBase * [1, .85, .7, .6][place - 1]);
            run.reward = { ryo: paid, reputation, place };
            run.status = 'complete';
            progress.reputation += reputation;
            progress.championships++;
            if (place === 1) progress.wins++;
        }
    }
    return { character: { ...character, sunscarRally: progress, ...(paid ? { ryo: Number(character.ryo || 0) + paid, serverTitles: grantFestivalTitles(character, 'rally', progress.reputation) } : {}) }, paid, replay: false };
}

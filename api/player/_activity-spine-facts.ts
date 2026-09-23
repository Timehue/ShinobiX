import { normalizeMasteryFocus } from '../../shared/activity-spine.js';
import { countChronicleCards, validateDeckIds } from '../../shared/chronicle-duel.js';
import { activeCarriedPets } from '../_entitlements.js';
import { showdownBusyIssue } from '../pet/_showdown-readiness.js';
import { chronicleUnlocked } from '../card-clash/_starter-cards.js';
import { STORY_LEVELS, LIBERATOR_TITLES } from '../story/_settle.js';
import { storyBossEligibility } from '../story/_authoritative-story-combat.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { FLOOR_CATALOG } from '../towers/_floor-catalog.js';
import { storyTowerEligibility } from '../towers/_story-eligibility.js';
import { hasClearedTowerFloor, towerEntryCost } from '../towers/_entry-fee.js';
import { towerModeDisabled } from '../towers/_mode-control.js';
import { applyForge } from '../craft/_forge.js';
import { playerRankedV2AdmissionsEnabled } from '../pvp/_player-ranked-rollout.js';
import { parsePetRankedSeasonGate, PET_RANKED_SEASON_GATE_KEY } from '../pet/_ranked-preparation.js';
import { legacyTrialKey, nextTrialKind, trialProgress, type LegacyTrial } from '../_legacy-core.js';
import { legacyStatsKey, type LegacyStats } from '../_legacy-track.js';
import type { FocusFacts } from './_activity-spine.js';
import { normalizePetTutorialProgress } from '../../shared/pet-tutorial.js';
import { SHOWDOWN_DAILY_WIN_CAP } from '../../shared/pet-showdown-contract.js';
import { rankedLevelEligible, RANKED_LEVEL_WARNING } from '../../shared/ranked-eligibility.js';

const whole = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** No IO or writes. Catalogs and validators stay on the server. Unknown/malformed
 * collections cannot be promoted to a verified roster or deck. */
export function activitySaveFacts(character: Record<string, unknown>, now: number): FocusFacts {
    const level = whole(character.level);
    const storyKnown = Number.isInteger(character.storyProgress) && Number(character.storyProgress) >= 0
        && typeof character.village === 'string' && Object.hasOwn(LIBERATOR_TITLES, character.village);
    const completed = Math.min(STORY_LEVELS.length, whole(character.storyProgress));
    const pets = Array.isArray(character.pets) ? character.pets.filter(p => object(p)) : [];
    const carried = activeCarriedPets<Record<string, unknown>>({ ...character, pets });
    const breeding = object(character.petBreeding);
    const breedingKnown = !character.petBreeding || (breeding && (breeding.state !== 'breeding'
        || (Array.isArray(breeding.parentIds) && Number.isFinite(Number(breeding.readyAt)))));
    const usable = carried.filter(pet => breedingKnown && typeof pet.id === 'string' && typeof pet.name === 'string'
        && ![pet.training, pet.expedition].some(timer => timer && (!object(timer) || !Number.isFinite(Number(object(timer)?.endsAt))))
        && !showdownBusyIssue(character, [pet as Parameters<typeof showdownBusyIssue>[1][number]], now));
    const active = carried.find(p => p.id === character.activePetId) ?? carried[0];
    const deck = strings(character.cardClashDeck);
    const cards = strings(character.tileCards);
    const deckValid = Array.isArray(character.cardClashDeck) && deck.length === character.cardClashDeck.length
        && Array.isArray(character.tileCards) && validateDeckIds(deck, countChronicleCards(cards)).valid;
    const legacy = object(character.legacy);
    const floor = FLOOR_CATALOG.find(f => !hasClearedTowerFloor(character, f.id) && storyTowerEligibility(character, f.id).eligible);
    const cost = towerEntryCost(character, new Date(now).toISOString().slice(0, 10));
    const petTutorial = normalizePetTutorialProgress(character.petTutorialProgress);
    const familiarWithCompanionBattles = whole(character.totalPetWins) > 0
        || whole(character.petRankedWins) + whole(character.petRankedLosses) > 0;
    const today = new Date(now).toISOString().slice(0, 10);
    const dailyArenaWins = String(character.lastDailyReset ?? '') === today ? whole(character.dailyPetWins) : 0;
    return {
        story: { completed, total: STORY_LEVELS.length, nextLevel: STORY_LEVELS[completed] ?? null,
            nextEligible: storyKnown && storyBossEligibility(character).ok, known: storyKnown },
        ranked: { rating: whole(character.rankedRating) || 1000, wins: whole(character.rankedWins), ready: false,
            blocker: 'Review current season and queue availability in the Arena District.' },
        towers: { bestFloor: whole(character.battleTowerBestFloor), bestWave: whole(character.endlessTowerBestWave),
            spireTier: whole(character.battleTowerAscension),
            nextFloor: floor?.id, complete: FLOOR_CATALOG.every(f => hasClearedTowerFloor(character, f.id)),
            entryAffordable: Number.isFinite(Number(character.ryo)) && Number(character.ryo) >= cost,
            entryCost: cost, available: !towerModeDisabled() },
        companions: { count: pets.length, activeName: typeof active?.name === 'string' ? active.name.slice(0, 40) : '',
            activeLevel: whole(active?.level), expeditionActive: !!active?.expedition, ladderRating: whole(character.petRankedRating) || 1000,
            usableCount: Array.isArray(character.pets) ? usable.length : undefined, available: process.env.DISABLE_PET_SHOWDOWN !== '1',
            familiar: familiarWithCompanionBattles, showdownLessonCompleted: petTutorial.completedLessonIds.includes('showdown'),
            dailyArenaWins, arenaCapReached: dailyArenaWins >= SHOWDOWN_DAILY_WIN_CAP },
        chronicle: { deckCards: deck.length, collectionCards: cards.length, wins: whole(character.cardClashWins),
            deckValid, unlocked: chronicleUnlocked(character) },
        legacy: { accepted: typeof legacy?.legacyId === 'string', stage: whole(legacy?.stage) },
        profession: { selected: ['healer', 'vanguard', 'petTamer'].includes(String(character.profession)),
            label: String(character.profession ?? ''), rank: whole(character.professionRank), xp: whole(character.professionXp) },
        prestige: { level, specialJoninPassed: strings(character.examsPassed).includes('specialJonin'), pvpKills: whole(character.totalPvpKills) },
        // applyForge is the endpoint's pure immutable decision, not a mutation call.
        // No crafting is performed, resources consumed, or resulting save retained.
        supplies: { craftable: (!character.itemStacks || (Array.isArray(character.itemStacks) && character.itemStacks.every(s => object(s))))
            && !!applyForge(character, 'supply', 'item-smoke-bomb', 1) },
    };
}

export type ActivityFactReader = { get<T>(key: string): Promise<T | null> };

/** At most two additional reads for one selected domain. No bootstrap, CAS,
 * scanning, or mutating eligibility endpoints. Admissions still revalidate. */
export async function enrichActivityFacts(
    facts: FocusFacts, character: Record<string, unknown>, player: string, focusValue: unknown,
    reader: ActivityFactReader, now: number,
): Promise<FocusFacts> {
    const focus = normalizeMasteryFocus(focusValue);
    if (focus === 'ranked-pvp') {
        if (!rankedLevelEligible(character.level)) return { ...facts, ranked: { ...facts.ranked, ready: false, blocker: RANKED_LEVEL_WARNING } };
        if (!playerRankedV2AdmissionsEnabled()) return { ...facts, ranked: { ...facts.ranked, blocker: 'Ranked queue admissions are temporarily unavailable.' } };
        const [rawGate, season] = await Promise.all([
            reader.get<unknown>(PET_RANKED_SEASON_GATE_KEY), reader.get<{ id?: unknown }>('ranked:season:current'),
        ]);
        const gate = parsePetRankedSeasonGate(rawGate);
        const open = !!gate && gate.state === 'open' && gate.seasonId === Number(season?.id);
        // Admission authority keeps even terminal/cancelled receipts occupied
        // until settlement releases them (reservePlayerRankedAdmission).
        const admitted = gate?.playerAdmissions.some(a => a.a === player || a.b === player);
        return { ...facts, ranked: { ...facts.ranked, ready: open && !admitted && !isIncapacitated(character, now),
            blocker: !open ? 'The ranked season is not accepting new entries.' : admitted ? 'Your current ranked admission must finish before another entry.' : undefined } };
    }
    if (focus === 'legacy' && facts.legacy.accepted && facts.legacy.stage < 5) {
        const [trial, stats] = await Promise.all([
            reader.get<LegacyTrial>(legacyTrialKey(player)), reader.get<LegacyStats>(legacyStatsKey(player)),
        ]);
        if (trial && trial.legacyId === object(character.legacy)?.legacyId && trial.kind === nextTrialKind(facts.legacy.stage) && Array.isArray(trial.objectives)
            && trial.objectives.length > 0 && object(trial.baselines) && stats && object(stats)
            && trial.objectives.every(o => o && typeof o.stat === 'string' && Number.isFinite(o.delta) && o.delta > 0
                && Number.isFinite(Number(trial.baselines[o.stat] ?? 0)) && Number.isFinite(Number(stats[o.stat] ?? 0)))) {
            const progress = trialProgress(trial, stats);
            const next = progress.find(o => !o.done);
            return { ...facts, legacy: { ...facts.legacy, trialReady: !next,
                objective: next ? { stat: next.stat, progress: next.progress, target: next.delta } : undefined } };
        }
    }
    return facts;
}

import { ERA_CHAPTERS, type EraJourney, type EraJourneys } from '../shared/era-chapters.js';
import { legacyEnabled } from './_legacy-track.js';

export type EraCampaignEvidence =
    | { kind: 'mission'; receiptId: string; at: number; missionId: string }
    | { kind: 'gate'; receiptId: string; at: number; startedAt: number; depth: number; floor: number; bossResolved: boolean; extracted: boolean }
    | { kind: 'tower'; receiptId: string; at: number; startedAt: number; floor: number; story: boolean; spire?: boolean; humanMembers?: number; clean: boolean; withinPar: boolean; disrupted: boolean; avoided: boolean; baited: boolean };
const MISSION_RANKS: Readonly<Record<string, number>> = {
    'combat-c-patrol': 0, 'combat-b-escort': 1, 'combat-a-hunt': 2, 'combat-s-crisis': 3,
};
const RANKS = { C: 0, B: 1, A: 2, S: 3 };

/** Shape validation shared by admission and settlement. Never turn damaged counters into zero. */
export function readEraJourneys(value: unknown): EraJourneys {
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid era journey record.');
    const journeys: EraJourneys = {};
    for (const chapter of ERA_CHAPTERS) {
        const raw = (value as Record<string, unknown>)[chapter.eraId];
        if (raw === undefined) continue;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid era journey record.');
        const journey = raw as EraJourney;
        const route = chapter.routes.find(item => item.id === journey.routeId);
        if (!route || !Number.isFinite(journey.startedAt) || journey.startedAt <= 0
            || !journey.baselines || typeof journey.baselines !== 'object' || Array.isArray(journey.baselines)
            || Object.values(journey.baselines).some(n => !Number.isFinite(n) || n < 0)
            || (journey.completedAt !== undefined && (!Number.isFinite(journey.completedAt) || journey.completedAt < journey.startedAt))) {
            throw new Error('Invalid era journey record.');
        }
        if (journey.version === 2) {
            const stages = route.stages;
            const index = journey.stageIndex!;
            const counts = journey.stageCounts;
            const completed = journey.completedStages;
            const receipts = journey.proofReceipts;
            if (!stages || !Number.isInteger(index) || index < 0 || index > stages.length
                || !Number.isFinite(journey.stageStartedAt) || journey.stageStartedAt! < journey.startedAt
                || !counts || typeof counts !== 'object' || Array.isArray(counts)
                || !Array.isArray(completed) || completed.length !== index
                || !Array.isArray(receipts) || receipts.length > stages.reduce((n, stage) => n + stage.objectives.reduce((sum, objective) => sum + objective.required, 0), 0)
                || receipts.some(id => typeof id !== 'string' || id.length < 1 || id.length > 180) || new Set(receipts).size !== receipts.length
                || (journey.completedAt !== undefined && (index !== stages.length || journey.completedAt < journey.stageStartedAt!))
                || (journey.legacyCompletedAt !== undefined && (!Number.isFinite(journey.legacyCompletedAt) || journey.legacyCompletedAt <= 0))) {
                throw new Error('Invalid era campaign record.');
            }
            let lastAt = journey.startedAt;
            for (let i = 0; i < completed.length; i++) {
                const receipt = completed[i]!;
                if (receipt.id !== stages[i]!.id || !Number.isFinite(receipt.at) || receipt.at < lastAt || receipt.at > journey.stageStartedAt!) throw new Error('Invalid era stage receipt.');
                lastAt = receipt.at;
            }
            const objectives = stages[index]?.objectives ?? [];
            if (Object.entries(counts).some(([id, n]) => !Number.isSafeInteger(n) || n < 0 || !objectives.some(objective => objective.id === id && n <= objective.required))) throw new Error('Invalid era stage proof.');
        } else if (journey.version !== undefined
            || (!route.stages && route.objectives.some(objective => !Number.isFinite(journey.baselines[objective.id])))) {
            throw new Error('Invalid era journey version or baseline.');
        } else if (route.stages && !Object.keys(journey.baselines).length) {
            throw new Error('Invalid historical era baseline.');
        }
        journeys[chapter.eraId] = journey;
    }
    return journeys;
}

/** Called inside the source's player-save transaction, after its own victory checks.
 * Receipts remain for the entire campaign, so replay cannot credit a later stage. */
export function recordEraCampaignEvidence<T extends Record<string, unknown>>(character: T, evidence: EraCampaignEvidence, now = Date.now()): T {
    if (!legacyEnabled() || !character.eraJourneys) return character;
    if (!evidence.receiptId || evidence.receiptId.length > 180 || !Number.isFinite(evidence.at) || evidence.at <= 0 || evidence.at > now) throw new Error('Invalid era campaign evidence.');
    if (evidence.kind !== 'mission' && (!Number.isFinite(evidence.startedAt) || evidence.startedAt <= 0 || evidence.startedAt > evidence.at)) throw new Error('Invalid era campaign evidence timeline.');
    const journeys = readEraJourneys(character.eraJourneys);
    for (const chapter of ERA_CHAPTERS) {
        const journey = journeys[chapter.eraId];
        if (journey?.version !== 2 || journey.completedAt || journey.proofReceipts!.includes(evidence.receiptId)) continue;
        const route = chapter.routes.find(item => item.id === journey.routeId)!;
        const stage = route.stages?.[journey.stageIndex!];
        if (!stage || evidence.at < journey.stageStartedAt!) continue;
        const counts = { ...journey.stageCounts };
        let changed = false;
        for (const objective of stage.objectives) {
            if ((counts[objective.id] ?? 0) >= objective.required) continue;
            const proof = objective.proof;
            const matches = proof.kind === 'mission' && evidence.kind === 'mission'
                ? (MISSION_RANKS[evidence.missionId] ?? -1) >= RANKS[proof.minimumRank]
                : proof.kind === 'gate' && evidence.kind === 'gate'
                    ? evidence.extracted && evidence.bossResolved && evidence.depth === 5 && evidence.floor === 5 && evidence.startedAt >= journey.stageStartedAt!
                    : proof.kind === 'tower' && evidence.kind === 'tower'
                        ? (proof.mode === 'spire' ? evidence.spire === true && !evidence.story && evidence.humanMembers === 4 : evidence.story && !evidence.spire)
                            && evidence.floor === proof.floor && evidence.clean && evidence.withinPar
                            && evidence.startedAt >= journey.stageStartedAt! && (!proof.disrupt || evidence.disrupted)
                            && (proof.signature !== 'avoid' || evidence.avoided) && (proof.signature !== 'bait' || evidence.baited)
                        : false;
            if (!matches) continue;
            counts[objective.id] = (counts[objective.id] ?? 0) + 1;
            changed = true;
        }
        if (!changed) continue;
        const passed = stage.objectives.every(objective => (counts[objective.id] ?? 0) >= objective.required);
        journeys[chapter.eraId] = { ...journey, stageCounts: passed ? {} : counts,
            proofReceipts: [...journey.proofReceipts!, evidence.receiptId],
            ...(passed ? { stageIndex: journey.stageIndex! + 1, stageStartedAt: now, completedStages: [...journey.completedStages!, { id: stage.id, at: now }] } : {}),
        };
        return { ...character, eraJourneys: journeys };
    }
    return character;
}

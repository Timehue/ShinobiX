import type { Character } from '../types/character';
import type { Screen } from '../types/core';
import { currentLogbookObjective, objectiveComplete } from './logbook-objectives';

/** Reuse live Logbook progress; the journal never stores a second checklist. */
export function firstContractNextGoal(character: Character, trainingRunning = false): { title: string; detail: string; screen: Screen; action: string } {
    const objective = currentLogbookObjective(character);
    if (!objective) return { title: 'Choose your next milestone', detail: 'Your Logbook shows advancement requirements and optional goals.', screen: 'logbook', action: 'Open Logbook' };
    if (objectiveComplete(objective)) return { title: objective.title, detail: 'Your requirements are complete. Open the Logbook to claim or pass this milestone.', screen: 'logbook', action: 'Open Logbook' };
    const remaining = objective.requirements.filter((requirement) => requirement.progress < requirement.target);
    const requirement = (trainingRunning ? remaining.find((r) => r.goScreen && r.goScreen !== 'training') : null) ?? remaining[0];
    return {
        title: objective.title,
        detail: `${requirement.label}: ${Math.min(requirement.target, requirement.progress)}/${requirement.target}.${requirement.detail ? ` ${requirement.detail}` : ''}`,
        screen: requirement.goScreen ?? 'logbook',
        action: requirement.goLabel ?? 'Open Logbook',
    };
}

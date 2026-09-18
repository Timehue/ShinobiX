import type { Character } from '../types/character';
import type { CreatorEvent } from '../types/vn';
import { craftDungeonEvents, hiddenDungeonVnEvent } from '../data/vn-events';
import { dungeonPresentationId } from '../../../shared/dungeon-presentation';

export function dungeonEventForRun(run: Character['activeDungeonRun'], edited: CreatorEvent[], legacy?: CreatorEvent): CreatorEvent {
    // Older runs did not record their theme. Preserve the current session's
    // selection when available; a free discovery always uses its hidden gate.
    const id = run?.entry === 'free' ? hiddenDungeonVnEvent.id
        : dungeonPresentationId(run?.presentationEventId ?? legacy?.id);
    return edited.find(event => event.id === id) ?? craftDungeonEvents.find(event => event.id === id) ?? hiddenDungeonVnEvent;
}

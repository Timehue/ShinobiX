import type { Character } from '../types/character';
import { storyFieldHistories, storyFieldObjective } from '../lib/story-field-work';
import './StoryFieldWork.css';

export function StoryFieldJournal({ character, currentSector, abandonBusy = false, onLocate, onOpen, onReview, onAbandon }: {
    character: Character; currentSector: number; onLocate: (sector: number) => void;
    onOpen: (questId: string, pointId: string) => void; onReview: (questId: string, pointId: string) => void;
    abandonBusy?: boolean; onAbandon: () => void;
}) {
    const objective = storyFieldObjective(character);
    const remembered = storyFieldHistories(character);
    if (!objective && !remembered.length) return null;
    return <aside className="story-field-journal" aria-label="Personal quest">
        {objective && <><div><strong>{objective.title}</strong><p>{objective.objective}</p>
            <span>{objective.name} · Sector {objective.sector}</span></div>
        <div className="story-field-journal-actions">
            <button onClick={() => onLocate(objective.sector)}>Show destination</button>
            {objective.pointId && currentSector === objective.sector && <button onClick={() => onOpen(objective.questId, objective.pointId!)}>Explore {objective.name}</button>}
            <button disabled={abandonBusy} onClick={onAbandon}>{abandonBusy ? 'Releasing…' : 'Abandon reckoning'}</button>
        </div>
        {objective.history.length > 0 && <details><summary>Your route so far</summary>
            <ol>{objective.history.map((visit) => <li key={visit.pointId}><button onClick={() => onReview(objective.questId, visit.pointId)}>{visit.name}</button></li>)}</ol>
        </details>}</>}
        {remembered.length > 0 && <details><summary>Your journeys</summary>
            {remembered.map((journey) => <div key={journey.questId}><strong>{journey.title}</strong>
                <ol>{journey.history.map((visit) => <li key={visit.pointId}><button onClick={() => onReview(journey.questId, visit.pointId)}>{visit.name}</button></li>)}</ol>
            </div>)}
        </details>}
    </aside>;
}

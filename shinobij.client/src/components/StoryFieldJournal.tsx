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
        <details className="story-field-journal-disclosure">
        <summary className="story-field-journal-toggle">
            <span><strong>{objective?.title ?? 'Your journeys'}</strong>
                <small>{objective ? `${objective.name} · Sector ${objective.sector}` : 'Review your past routes'}</small></span>
            <span className="story-field-journal-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="story-field-journal-body">
        {objective && <><p>{objective.objective}</p>
        <div className="story-field-journal-actions">
            <button type="button" onClick={() => onLocate(objective.sector)}>Show destination</button>
            {objective.pointId && currentSector === objective.sector && <button type="button" onClick={() => onOpen(objective.questId, objective.pointId!)}>Explore {objective.name}</button>}
            <button type="button" disabled={abandonBusy} onClick={onAbandon}>{abandonBusy ? 'Releasing…' : 'Abandon reckoning'}</button>
        </div>
        {objective.history.length > 0 && <details><summary>Your route so far</summary>
            <ol>{objective.history.map((visit) => <li key={visit.pointId}><button type="button" onClick={() => onReview(objective.questId, visit.pointId)}>{visit.name}</button></li>)}</ol>
        </details>}</>}
        {remembered.length > 0 && <details><summary>Your journeys</summary>
            {remembered.map((journey) => <div key={journey.questId}><strong>{journey.title}</strong>
                <ol>{journey.history.map((visit) => <li key={visit.pointId}><button type="button" onClick={() => onReview(journey.questId, visit.pointId)}>{visit.name}</button></li>)}</ol>
            </div>)}
        </details>}
        </div>
        </details>
    </aside>;
}

import { useEffect, useRef, useState } from 'react';
import type { Character, VersionedCharacterCommit } from '../types/character';
import type { Biome } from '../types/core';
import { reportStoryFieldChoice, storyFieldPointEvent } from '../lib/story-field-work';
import { TriggeredVisualNovel } from './TriggeredVisualNovel';
import './StoryFieldWork.css';

export function StoryFieldScene({ questId, pointId, character, biome, review = false, sharedImages, onCharacter, onClose }: {
    questId: string; pointId: string; character: Character; biome: Biome; review?: boolean;
    sharedImages?: Record<string, string>; onCharacter: VersionedCharacterCommit; onClose: () => void;
}) {
    // Keep this scene intact while a saved choice advances the parent's route.
    const [event] = useState(() => storyFieldPointEvent(questId, pointId, character, biome, review));
    const [page, setPage] = useState(0), [line, setLine] = useState(0);
    const [status, setStatus] = useState<'ready' | 'saving' | 'saved' | 'error'>('ready');
    const [error, setError] = useState('');
    const choiceRef = useRef<string | null>(null), busyRef = useRef(false), closeWhenSaved = useRef(false);
    const mountedRef = useRef(true), requestRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            requestRef.current += 1;
        };
    }, []);

    async function commit(choiceId: string) {
        if (review || busyRef.current || status === 'saved') return;
        busyRef.current = true;
        const requestId = ++requestRef.current;
        choiceRef.current = choiceId;
        setStatus('saving'); setError('');
        const result = await reportStoryFieldChoice(character.name, questId, pointId, choiceId);
        const adopted = result.character ? onCharacter(result.character, result._saveVersion) : false;
        if (!mountedRef.current || requestRef.current !== requestId) return;
        busyRef.current = false;
        if (!result.ok) {
            setStatus('error');
            setError(result.reason === 'wrong-place' ? 'Return to this location to continue.'
                : result.reason === 'traveling' ? 'Finish traveling, then try again.'
                    : result.reason === 'in-battle' ? 'Finish the battle, then try again.'
                        : result.reason === 'choice-locked' || result.reason === 'out-of-order' || result.reason === 'none'
                            ? 'Your journey has moved on. Close this scene to see the current step.'
                            : 'Your choice could not be saved. Retry when your connection is ready.');
            return;
        }
        if (!result.character || !adopted) {
            setStatus('error');
            setError('Your choice was sealed, but this view could not refresh. Retry to recover it.');
            return;
        }
        setStatus('saved');
        if (closeWhenSaved.current) onClose();
    }

    function close() {
        requestRef.current += 1;
        onClose();
    }

    function finish() {
        if (review || status === 'saved') { close(); return; }
        closeWhenSaved.current = true;
        if (status === 'ready' && choiceRef.current) void commit(choiceRef.current);
    }

    if (!event) return <div className="story-field-status" role="status"><span>This scene is no longer available.</span><button onClick={close}>Return to the road</button></div>;
    return <div className="story-field-scene">
        <TriggeredVisualNovel event={event} character={character} pageIndex={page} lineIndex={line}
            setPageIndex={setPage} setLineIndex={setLine} sharedImages={sharedImages} readOnlyReplay={review}
            onCancel={close} onComplete={finish} onBattle={() => {}}
            onChoice={review ? undefined : (choice) => { if (choice.id) void commit(choice.id); }} />
        {(status === 'saving' || status === 'error') && <div className="story-field-status" role="status" aria-live="polite">
            <span>{status === 'saving' ? 'Saving your choice…' : error}</span>
            {status === 'error' && <button onClick={() => { if (choiceRef.current) void commit(choiceRef.current); }}>Retry</button>}
            {status === 'error' && <button onClick={close}>Return to the road</button>}
        </div>}
    </div>;
}

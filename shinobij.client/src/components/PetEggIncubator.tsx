import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { advancePetIncubation, hatchPetBreeding } from '../lib/pet-breeding-api';
import { PET_EGG_TICK_MS } from '../../../shared/pet-incubation';
import type { BeginCharacterSync, Character, VersionedCharacterCommit } from '../types/character';
import type { Pet } from '../types/pet';
import type { Screen } from '../types/core';
import { hasBlockingHatchDialog, petHatchPresentationBlocked } from '../lib/pet-hatch-presentation';

const Reveal = lazyWithRetry(() => import('./PetHatchReveal').then(m => ({ default: m.PetHatchReveal })));

export function PetEggIncubator({ character, onVersionedCharacter, beginCharacterSync, blocked: runtimeBlocked, sharedImages, screen }: {
    character: Character; onVersionedCharacter: VersionedCharacterCommit; blocked: boolean; sharedImages: Record<string, string>; screen: Screen;
    beginCharacterSync?: BeginCharacterSync;
}) {
    const [readyPet, setReadyPet] = useState<{ pet: Pet; sessionId: string } | null>(null);
    const [localReady, setLocalReady] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [foreground, setForeground] = useState(() => !document.hidden && document.hasFocus());
    const [dialogBlocked, setDialogBlocked] = useState(false);
    const [ackBusy, setAckBusy] = useState(false);
    const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(() => new Set());
    const [error, setError] = useState('');
    const alive = useRef(true);
    const retryTimer = useRef<number | undefined>(undefined);
    const blocked = petHatchPresentationBlocked(character, screen, runtimeBlocked) || dialogBlocked;
    const latest = useRef({ character, blocked, onVersionedCharacter, beginCharacterSync });
    useLayoutEffect(() => { latest.current = { character, blocked, onVersionedCharacter, beginCharacterSync }; },
        [character, blocked, onVersionedCharacter, beginCharacterSync]);
    const hatchBusy = useRef(false);
    const sessionId = character.petBreeding?.sessionId;
    useEffect(() => {
        alive.current = true;
        const changed = () => setForeground(!document.hidden && document.hasFocus());
        document.addEventListener('visibilitychange', changed); window.addEventListener('focus', changed); window.addEventListener('blur', changed);
        return () => { alive.current = false; window.clearTimeout(retryTimer.current);
            document.removeEventListener('visibilitychange', changed); window.removeEventListener('focus', changed); window.removeEventListener('blur', changed); };
    }, []);
    useEffect(() => {
        if (!sessionId) return;
        const activityId = crypto.randomUUID();
        let last = performance.now(), wasActive = false, inFlight = false, cancelled = false;
        const controller = new AbortController();
        async function tick() {
            if (inFlight || cancelled) return;
            const active = !document.hidden && document.hasFocus();
            const now = performance.now(), elapsedMs = wasActive && active ? Math.max(0, now - last) : 0;
            last = now; wasActive = active;
            inFlight = true;
            try {
                const authority = await latest.current.beginCharacterSync?.(character.name);
                if (cancelled || (authority && !authority.isCurrent())) return;
                const state = await advancePetIncubation(latest.current.character.name, { id: activityId, active, elapsedMs }, controller.signal);
                if (cancelled) return;
                if (state.character) (authority?.commit ?? latest.current.onVersionedCharacter)(state.character, state._saveVersion);
                if (state.session && state.session.sessionId === sessionId && state.session.incubationRemainingMs === 0) setLocalReady(state.session.sessionId);
            } catch { /* A missed lease pauses incubation; reconnect never catches up offline time. */ }
            finally { inFlight = false; }
        }
        const visibility = () => { wasActive = false; last = performance.now(); void tick(); };
        void tick();
        const interval = window.setInterval(() => { if (!document.hidden && document.hasFocus()) void tick(); }, PET_EGG_TICK_MS);
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('blur', visibility); window.addEventListener('focus', visibility);
        return () => { cancelled = true; controller.abort(); window.clearInterval(interval);
            document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', visibility); window.removeEventListener('focus', visibility); };
    }, [character.name, sessionId]);

    const ready = Boolean(sessionId && !acknowledged.has(sessionId) && (character.petBreeding?.incubationRemainingMs === 0 || localReady === sessionId));
    const queued = character.petBreedingHatchReceipts?.find(receipt => receipt.revealPending && !acknowledged.has(receipt.sessionId));
    const hatchSessionId = queued?.sessionId ?? (ready ? sessionId : undefined);
    useEffect(() => {
        if (!hatchSessionId && !readyPet) return;
        const update = () => setDialogBlocked(hasBlockingHatchDialog());
        update();
        const observer = new MutationObserver(update);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-hidden', 'style'] });
        return () => observer.disconnect();
    }, [hatchSessionId, readyPet]);
    useEffect(() => {
        if (!hatchSessionId || blocked || readyPet || hatchBusy.current || !foreground || hasBlockingHatchDialog()) return;
        hatchBusy.current = true;
        void (async () => {
            const authority = await latest.current.beginCharacterSync?.(character.name);
            if (!alive.current || (authority && !authority.isCurrent())) return;
            const result = await hatchPetBreeding({ playerName: character.name, sessionId: hatchSessionId });
            if (!alive.current) return;
            if (authority && !authority.isCurrent()) return;
            (authority?.commit ?? latest.current.onVersionedCharacter)(result.character, result._saveVersion);
            if (result.character.petBreedingHatchReceipts?.some(receipt => receipt.sessionId === hatchSessionId && receipt.revealPending === false)) {
                setAcknowledged(prior => new Set([...prior, hatchSessionId]));
                return;
            }
            setReadyPet({ pet: result.pet, sessionId: hatchSessionId }); setLocalReady(null);
        })().catch(() => {
            if (alive.current) retryTimer.current = window.setTimeout(() => setRetry(value => value + 1), PET_EGG_TICK_MS);
        }).finally(() => { hatchBusy.current = false; });
        // Preserve an in-flight successful hatch even if a fight opens while
        // awaiting the response. Presentation below stays queued behind it.
    }, [character.name, hatchSessionId, blocked, readyPet, retry, foreground]);
    async function acknowledge() {
        if (!readyPet || ackBusy) return;
        setAckBusy(true); setError('');
        try {
            const authority = await latest.current.beginCharacterSync?.(character.name);
            if (!alive.current || (authority && !authority.isCurrent())) return;
            const result = await hatchPetBreeding({ playerName: character.name, sessionId: readyPet.sessionId, acknowledgeReveal: true });
            if (!alive.current) return;
            if (authority && !authority.isCurrent()) return;
            (authority?.commit ?? latest.current.onVersionedCharacter)(result.character, result._saveVersion);
            setAcknowledged(prior => new Set([...prior, readyPet.sessionId]));
            setReadyPet(null);
        } catch { if (alive.current) setError('Your companion is safe. Try welcoming it again when the connection returns.'); }
        finally { if (alive.current) setAckBusy(false); }
    }
    return readyPet && !blocked && foreground ? <Suspense fallback={null}><Reveal pet={readyPet.pet} sharedImages={sharedImages}
        busy={ackBusy} error={error} onClose={() => void acknowledge()} /></Suspense> : null;
}

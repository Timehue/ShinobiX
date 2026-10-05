import { lazy, Suspense, useEffect } from 'react';
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from '../../types/character';
import type { GameItem, Jutsu, SavedBloodline } from '../../types/combat';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import type { TowerSession } from '../../lib/towers-api';
import { soloPveArenaTransport, soloPveSessionForArena } from '../../lib/solo-pve-arena-adapter';
import { submitTowerActionWithLostResponseRetry } from '../../lib/towers-api';
const MissionArenaFight = lazy(() => import('../../screens/MissionArenaFight').then(m => ({ default: m.MissionArenaFight })));
const BattleTowerFight = lazy(() => import('../../screens/BattleTowerFight').then(m => ({ default: m.BattleTowerFight })));
export type CaravanCombatCatalogs = { sharedImages?: Record<string, string>; savedBloodlines?: SavedBloodline[]; creatorJutsus?: Jutsu[]; creatorItems?: GameItem[]; onFightOpenChange?: (open: boolean) => void; onRecordBattle?: (entry: BattleHistoryEntry) => void };
function CaravanBattleResult({ won, settleState, retry, onExit }: { won: boolean; settleState: 'idle' | 'pending' | 'settled' | 'failed'; retry: () => void; onExit: () => void }) {
    return <div className="battle-ended-overlay"><div className="card battle-ended-card caravan-battle-result" role="status">
        <p className="sunscar-eyebrow">Caravan Run</p><h2>{won ? 'The road is open' : 'The escort has ended'}</h2>
        <p>{settleState === 'settled' ? won ? 'The crew is ready to move. Returning to the route map…' : 'The delivery has ended. Returning to the dispatch office…' : settleState === 'failed' ? 'The outcome could not be saved. Retry or return to reconnect.' : 'Saving your battle outcome…'}</p>
        {settleState === 'failed' && <button onClick={retry}>Retry saving outcome</button>}
        <button disabled={settleState === 'pending' || settleState === 'idle'} onClick={onExit}>Return to the caravan</button>
    </div></div>;
}
export function CaravanBattle({ character, session, title, settle, onExit, onFightOpenChange, onVersionedCharacter, ...catalogs }: CaravanCombatCatalogs & {
    character: Character; session: SoloPveSession | TowerSession; title: string; settle: () => Promise<unknown>; onExit: () => void;
    onVersionedCharacter?: VersionedCharacterCommit;
}) {
    useEffect(() => { onFightOpenChange?.(true); return () => onFightOpenChange?.(false); }, [onFightOpenChange]);
    if ('actors' in session) return <Suspense fallback={<div className="sunscar-loading" role="status">The raiders are closing in…</div>}><BattleTowerFight
        sharedImages={catalogs.sharedImages} character={character} runId={session.runId} initialSession={session}
        onVersionedCharacter={onVersionedCharacter} variant="caravan-ambush" pvpContextLabel="Caravan Ambush"
        actionRetryFn={submitTowerActionWithLostResponseRetry} settleFn={settle} settleOnAnyDone
        onExit={onExit} onLeaveActive={onExit}
    /></Suspense>;
    const legacy = session as SoloPveSession;
    return <Suspense fallback={<div className="sunscar-loading" role="status">Preparing the encounter…</div>}><MissionArenaFight
        {...catalogs} character={character} runId={legacy.sessionId} initialSession={soloPveSessionForArena(legacy)}
        transport={soloPveArenaTransport} missionName={title} eventLabel="Caravan Run" recordMode="Caravan escort"
        settleOnAnyDone settleFn={settle} onExit={onExit}
        renderResult={({ won, settleState, retry, onExit: exit }) => <CaravanBattleResult won={won} settleState={settleState} retry={retry} onExit={exit} />}
    /></Suspense>;
}

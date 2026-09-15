import { lazy, Suspense, useEffect, useMemo } from 'react';
import type { BattleHistoryEntry, Character } from '../../types/character';
import type { GameItem, Jutsu, SavedBloodline } from '../../types/combat';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { soloPveArenaTransport, soloPveSessionForArena } from '../../lib/solo-pve-arena-adapter';
import type { CaravanResponse } from '../../lib/sunscar-caravan';
import queenArt from '../../assets/festival/sunscar-queen-v1.webp';
import queenBody from '../../assets/festival/sunscar-queen-body-v1.webp';
const MissionArenaFight = lazy(() => import('../../screens/MissionArenaFight').then(m => ({ default: m.MissionArenaFight })));
export type CaravanCombatCatalogs = { sharedImages?: Record<string, string>; savedBloodlines?: SavedBloodline[]; creatorJutsus?: Jutsu[]; creatorItems?: GameItem[]; onFightOpenChange?: (open: boolean) => void; onRecordBattle?: (entry: BattleHistoryEntry) => void };
function CaravanBattleResult({ won, settleState, retry, onExit }: { won: boolean; settleState: 'idle' | 'pending' | 'settled' | 'failed'; retry: () => void; onExit: () => void }) {
    useEffect(() => {
        if (settleState !== 'settled') return;
        const timer = window.setTimeout(onExit, 1800);
        return () => window.clearTimeout(timer);
    }, [settleState, onExit]);
    return <div className="battle-ended-overlay"><div className="card battle-ended-card caravan-battle-result" role="status">
        <p className="sunscar-eyebrow">Caravan Run</p><h2>{won ? 'The road is open' : 'The escort has ended'}</h2>
        <p>{settleState === 'settled' ? won ? 'The crew is ready to move. Returning to the route map…' : 'The delivery has ended. Returning to the dispatch office…' : settleState === 'failed' ? 'The outcome could not be saved. Retry or return to reconnect.' : 'Saving your battle outcome…'}</p>
        {settleState === 'failed' && <button onClick={retry}>Retry saving outcome</button>}
        <button disabled={settleState === 'pending'} onClick={onExit}>{settleState === 'pending' ? 'Saving outcome…' : 'Return to the caravan'}</button>
    </div></div>;
}
export function CaravanBattle({ character, session, title, settle, onExit, onFightOpenChange, ...catalogs }: CaravanCombatCatalogs & {
    character: Character; session: SoloPveSession; title: string; settle: () => Promise<CaravanResponse>; onExit: () => void;
}) {
    useEffect(() => { onFightOpenChange?.(true); return () => onFightOpenChange?.(false); }, [onFightOpenChange]);
    const sharedImages = useMemo(() => session.enemy.name === 'Scorpion Queen'
        ? { ...catalogs.sharedImages, [`ai:${String(session.enemy.character.visual)}:body`]: queenBody }
        : catalogs.sharedImages, [catalogs.sharedImages, session.enemy.name, session.enemy.character.visual]);
    return <Suspense fallback={<div className="sunscar-loading" role="status">Preparing the encounter…</div>}><MissionArenaFight
        {...catalogs} sharedImages={sharedImages} character={character} runId={session.sessionId} initialSession={soloPveSessionForArena(session)}
        enemyAvatarOverride={session.enemy.name === 'Scorpion Queen' ? queenArt : undefined}
        transport={soloPveArenaTransport} missionName={title} eventLabel="Caravan Run" recordMode="Caravan escort"
        settleOnAnyDone settleFn={settle} onExit={onExit}
        renderResult={({ won, settleState, retry, onExit: exit }) => <CaravanBattleResult won={won} settleState={settleState} retry={retry} onExit={exit} />}
    /></Suspense>;
}

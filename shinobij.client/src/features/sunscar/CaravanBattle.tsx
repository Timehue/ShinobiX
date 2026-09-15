import { lazy, Suspense, useEffect, useMemo } from 'react';
import type { BattleHistoryEntry, Character, VersionedCharacterCommit } from '../../types/character';
import type { GameItem, Jutsu, SavedBloodline } from '../../types/combat';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { soloPveArenaTransport, soloPveSessionForArena } from '../../lib/solo-pve-arena-adapter';
import { reportPveFightOutcome } from '../../lib/pve-outcome-api';
import type { CaravanResponse } from '../../lib/sunscar-caravan';
import queenArt from '../../assets/festival/sunscar-queen-v1.webp';
import queenBody from '../../assets/festival/sunscar-queen-body-v1.webp';
const MissionArenaFight = lazy(() => import('../../screens/MissionArenaFight').then(m => ({ default: m.MissionArenaFight })));
export type CaravanCombatCatalogs = { sharedImages?: Record<string, string>; savedBloodlines?: SavedBloodline[]; creatorJutsus?: Jutsu[]; creatorItems?: GameItem[]; onFightOpenChange?: (open: boolean) => void; onRecordBattle?: (entry: BattleHistoryEntry) => void };
export function CaravanBattle({ character, session, title, onVersionedCharacter, settle, onExit, onFightOpenChange, ...catalogs }: CaravanCombatCatalogs & {
    character: Character; session: SoloPveSession; title: string; onVersionedCharacter: VersionedCharacterCommit; settle: () => Promise<CaravanResponse>; onExit: () => void;
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
        outcomeFn={async (id, name) => { const result = await reportPveFightOutcome(id, name); if (result.character) onVersionedCharacter(result.character, result._saveVersion); await settle(); return result; }}
        renderResult={({ won, settleState, retry, onExit: exit }) => <div className="caravan-battle-result"><p className="sunscar-eyebrow">Caravan Run</p><h2>{won ? 'The road is open' : 'The escort has ended'}</h2><p>{won ? 'The crew is ready to move. Your remaining condition carries into the next leg.' : 'The crew has withdrawn. Your battle outcome and expedition have been recorded.'}</p>{settleState === 'failed' && <><p>Your battle record is safe. Retry now or return to the caravan to reconnect.</p><button onClick={retry}>Retry saving outcome</button></>}<button disabled={settleState === 'pending'} onClick={exit}>{settleState === 'pending' ? 'Saving outcome…' : 'Return to the caravan'}</button></div>}
    /></Suspense>;
}

import { Suspense, type ComponentProps } from 'react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { SoloPveSession } from '../lib/solo-pve-api';
import { MissionArenaFight } from './MissionArenaFight';

// Hunts reuse the Tower grid screen; every other AI fight keeps the arena screen.
// The choice lives in this lazy module so the host's eager code stays unchanged.
const HuntTowerFight = lazyWithRetry(() => import('./HuntTowerFight'));

type ArenaProps = ComponentProps<typeof MissionArenaFight>;

export default function AiFightScreen({ huntSession, huntSettleFn, enemyAvatar, ...arena }: ArenaProps & {
    /** The sealed server session; a hunt battlefield on it switches to the grid screen. */
    huntSession: SoloPveSession;
    huntSettleFn: (runId: string, playerName: string) => Promise<unknown>;
    enemyAvatar?: string;
}) {
    if (!huntSession.huntCombat) return <MissionArenaFight {...arena} />;
    return (
        <Suspense fallback={null}>
            <HuntTowerFight
                character={arena.character}
                sharedImages={arena.sharedImages}
                session={huntSession}
                settleFn={huntSettleFn}
                enemyAvatar={enemyAvatar}
                onRecordBattle={arena.onRecordBattle}
                onExit={arena.onExit}
            />
        </Suspense>
    );
}
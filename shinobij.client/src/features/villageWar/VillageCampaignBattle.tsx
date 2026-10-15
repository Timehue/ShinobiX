import { useCallback, useMemo } from 'react';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import type { SoloPveSession } from '../../lib/solo-pve-api';
import { MissionArenaFight } from '../../screens/MissionArenaFight';
import { soloPveSessionForArena, soloPveArenaTransport } from '../../lib/solo-pve-arena-adapter';
import { CardClashDuelScreen, type CardClashDuelConfig } from '../../screens/ClanWarTileCardDuel';
import { PetDuelReplayScreen } from '../../components/PetDuelReplayScreen';
import { activeCarriedPets } from '../../lib/entitlements';
import type { ShowdownReplayScript } from '../../../../shared/pet-showdown-contract';
import { campaignRequest, type CampaignBattle, type CampaignPetSession } from '../../lib/village-war-campaign';

export default function VillageCampaignBattle({ character, warId, run, sharedImages = {}, onVersionedCharacter, onBack }: {
    character: Character; warId: string; run: CampaignBattle; sharedImages?: Record<string, string>;
    onVersionedCharacter: VersionedCharacterCommit; onBack: () => void;
}) {
    const request = useCallback((action: string) => campaignRequest(character.name, warId, action, { runId: run.runId }), [character.name, warId, run.runId]);
    const settle = useCallback(async () => {
        const response = await request('resolve');
        if (response.character) onVersionedCharacter(response.character, response._saveVersion);
        return response;
    }, [request, onVersionedCharacter]);
    const cardConfig = useMemo<CardClashDuelConfig>(() => ({ stashKey: 'villageCampaignCard.v1', endpoint: '/api/village/war-campaign',
        title: 'Village War · Card Stronghold', backScreen: 'villageWar', backLabel: 'Back to war',
        emptyTitle: 'Battle unavailable', emptyNote: 'Return to the war objectives.', emptyBackLabel: 'Back',
        awaitingNote: 'Preparing the stronghold defense.', forfeitConfirm: 'Forfeit this stronghold battle?',
        doneNote: () => 'The server recorded this battle. Return to the war to see the score.', autoJoin: true }), []);
    const cardContext = useMemo(() => ({ name: character.name, warId, runId: run.runId }), [character.name, warId, run.runId]);
    if (run.mode === 'card') return <CardClashDuelScreen character={character} setScreen={onBack} config={cardConfig} sharedImages={sharedImages} context={cardContext} />;
    if (run.mode === 'pet') return <PetDuelReplayScreen<CampaignPetSession> pets={activeCarriedPets(character)} config={{
        title: 'Village War · Pet Stronghold', intro: 'Your sealed pet team fights the stronghold defense.',
        missingText: 'No pet battle selected.', backLabel: 'Back to war', onBack, ready: true, pickerless: { loading: 'Loading the sealed battle…', missing: 'This battle could not be loaded.' },
        submitLabel: 'Watch battle', submitErrorText: 'Could not load the pet battle.', submit: async () => ({ session: (await request('state')).session as CampaignPetSession }),
        fetchState: async () => (await request('state')).session as CampaignPetSession,
        resolved: session => session.status === 'done', watch: async () => {
            const response = await request('watch') as unknown as { script?: ShowdownReplayScript };
            return response.script ?? null;
        }, banner: session => `${session.winner === 'p1' ? session.p1.name : session.p2.name} won the battle.`,
        waiting: () => null, nextDuel: () => null }} />;
    if (run.npc && run.session) return <MissionArenaFight character={character} sharedImages={sharedImages} runId={run.runId}
        initialSession={soloPveSessionForArena(run.session as SoloPveSession)} transport={soloPveArenaTransport}
        onExit={onBack} eventLabel='Village War Operation' recordMode='Village War' settleFn={settle} settleOnAnyDone
        renderResult={({ settleState, settleResult, retry }) => <div className='battle-ended-overlay'><div className='card battle-ended-card'>
            <h2>War operation complete</h2>
            {settleState === 'failed' ? <button onClick={retry}>Retry report</button> : <p>{settleState === 'settled'
                ? `${(settleResult as CampaignBattle)?.warResult?.points ?? 0} supporting War Points recorded.` : 'Reporting the battle…'}</p>}
            <button onClick={onBack}>Back to war</button>
        </div></div>} />;
    return <div className='summary-box'><h3>Live combat defense</h3><p>Your battle is being opened in the PvP arena.</p><button onClick={onBack}>Back to war</button></div>;
}

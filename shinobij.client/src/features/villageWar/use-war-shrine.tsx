import { lazy, Suspense, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignView, CampaignObjective, CampaignFieldMissionView } from '../../../../shared/village-war-campaign';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import { VillageWarShrineEntrance } from './VillageWarShrineEntrance';
import { WarFieldMissionHud } from './WarFieldMissionHud';
const loadRoom = () => import('./VillageWarShrineRoom');
const Room = lazy(() => loadRoom().then(m => ({ default: m.VillageWarShrineRoom })));

/** WorldMap supplies travel/capability authority; this leaf owns the entered room. */
export function useWarShrine({ character, state, sharedImages, onVersionedCharacter, sector, currentSector, blocked, onEnterStronghold }: {
    character: Character; state: { warId: string; campaign: CampaignView; mission?: CampaignFieldMissionView | null } | null;
    sharedImages: Record<string, string>; onVersionedCharacter: VersionedCharacterCommit;
    sector: number | null; currentSector: number; blocked: boolean;
    onEnterStronghold: (target: { sector: number; village: string }) => void;
}) {
    const [room, setRoom] = useState<{ warId: string; objective: CampaignObjective; version: CampaignView['version'] } | null>(null);
    // Standing in a shrine sector, fetch the room before the player taps it. A failed
    // warm-up is the tap's failure too (the browser keeps a failed import).
    const shrineHere = !!state && sector !== null && sector === currentSector && state.campaign.shrine.some(objective => objective.sector === sector);
    useEffect(() => { if (shrineHere) void loadRoom().catch(() => undefined); }, [shrineHere]);
    // The landmark follows the terrain; the order tracker belongs to the fixed HUD.
    return { open: !!room, entrance: state && sector !== null ? <VillageWarShrineEntrance campaign={state.campaign}
        sector={sector} present={sector === currentSector} blocked={blocked || !!room}
        onEnter={objective => setRoom({ warId: state.warId, objective, version: state.campaign.version })} /> : null,
        tracker: !room ? <WarFieldMissionHud name={character.name} warId={state?.warId} mission={state?.mission} currentSector={currentSector} onEnter={onEnterStronghold} /> : null,
        overlay: room ? createPortal(<div className='stronghold-overlay'>
            <Suspense fallback={<p>Entering the golden shrine…</p>}><Room character={character} warId={room.warId}
                objective={room.objective} campaignVersion={room.version} sharedImages={sharedImages} onVersionedCharacter={onVersionedCharacter} onExit={() => setRoom(null)} />
            </Suspense></div>, document.body) : null };
}

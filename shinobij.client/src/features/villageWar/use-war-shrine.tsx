import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignView, CampaignObjective, CampaignFieldMissionView } from '../../../../shared/village-war-campaign';
import type { Character, VersionedCharacterCommit } from '../../types/character';
import { VillageWarShrineEntrance } from './VillageWarShrineEntrance';
import { WarFieldMissionHud } from './WarFieldMissionHud';
const Room = lazy(() => import('./VillageWarShrineRoom').then(m => ({ default: m.VillageWarShrineRoom })));

/** WorldMap supplies travel/capability authority; this leaf owns the entered room. */
export function useWarShrine({ character, state, sharedImages, onVersionedCharacter, sector, currentSector, blocked, onEnterStronghold }: {
    character: Character; state: { warId: string; campaign: CampaignView; mission?: CampaignFieldMissionView | null } | null;
    sharedImages: Record<string, string>; onVersionedCharacter: VersionedCharacterCommit;
    sector: number | null; currentSector: number; blocked: boolean;
    onEnterStronghold: (target: { sector: number; village: string }) => void;
}) {
    const [room, setRoom] = useState<{ warId: string; objective: CampaignObjective } | null>(null);
    // The landmark follows the terrain; the order tracker belongs to the fixed HUD.
    return { open: !!room, entrance: state && sector !== null ? <VillageWarShrineEntrance campaign={state.campaign}
        sector={sector} present={sector === currentSector} blocked={blocked || !!room}
        onEnter={objective => setRoom({ warId: state.warId, objective })} /> : null,
        tracker: !room ? <WarFieldMissionHud name={character.name} warId={state?.warId} mission={state?.mission} currentSector={currentSector} onEnter={onEnterStronghold} /> : null,
        overlay: room ? createPortal(<div className='stronghold-overlay'>
            <Suspense fallback={<p>Entering the golden shrine…</p>}><Room character={character} warId={room.warId}
                objective={room.objective} sharedImages={sharedImages} onVersionedCharacter={onVersionedCharacter} onExit={() => setRoom(null)} />
            </Suspense></div>, document.body) : null };
}

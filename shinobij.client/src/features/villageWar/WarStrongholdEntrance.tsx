import type { Character } from '../../types/character';
import type { CampaignFieldMissionView, CampaignView } from '../../../../shared/village-war-campaign';
import { ANBU_RAID_MIN_LEVEL, STRONGHOLD_MIN_LEVEL, isDeathsGateStronghold, strongholdLevelEligible, strongholdTitle } from '../../../../shared/sector-stronghold';
import { StrongholdDialog } from '../anbuInfiltration/StrongholdDialog';
import { warStrongholdEntryText } from './sector-vault-marker';

export function WarStrongholdEntrance({ character, target, campaign, mission, admissionOpen, onEnter, onClose }: {
    character: Character; target: { sector: number; village: string; warEntry?: boolean };
    campaign?: CampaignView; mission?: CampaignFieldMissionView | null; admissionOpen: boolean;
    onEnter: () => void; onClose: () => void;
}) {
    const minimumLevel = target.warEntry ? 15 : STRONGHOLD_MIN_LEVEL;
    const entryEligible = target.warEntry ? (character.level ?? 0) >= 15 : strongholdLevelEligible(character.level);
    const espionage = mission?.kind === 'espionage' && mission.status === 'active' && mission.sectors[0] === target.sector;
    const specialty = target.warEntry && campaign?.strongholds.some(o => o.sector === target.sector && o.village !== character.village) && !espionage;
    const obsidian = isDeathsGateStronghold(target.sector);
    const allied = target.village === character.village;
    const description = warStrongholdEntryText(campaign, target.sector, character.village, mission)
        ?? (obsidian ? 'Enter twelve obsidian chambers shared with other players. Every step raises threat; a patrol attacks after 25 steps. Your current health and supplies carry into every fight.'
            : allied ? target.warEntry ? 'Take guard duty from level 15 to confront enemy espionage visitors. Your allied Anbu stays on guard.'
                : 'Explore your village’s twelve-chamber stronghold, fight patrols, and watch for rival players. Your Anbu protects the war reserves in the vault at the far end.'
                : 'Explore 12 chambers, fight patrols, and watch for rival players. An Anbu guards the war vault at the far end. Each step raises threat. Break through to raid this sector’s war supplies.');
    return <StrongholdDialog title={strongholdTitle(target.sector)} onClose={onClose}>
        <img src='/landmarks/anbu-vault.webp' alt='' className={`stronghold-boss-portrait${obsidian ? ' stronghold-obsidian-portrait' : ''}`} />
        <p style={{ fontSize: 13, opacity: 0.82, margin: '0.3rem 0 0.8rem' }}>{description}</p>
        <p className='stronghold-reward-detail'>Stronghold entry unlocks at level {minimumLevel}.{!target.warEntry && !obsidian && !allied && ` Anbu treasury raids require level ${ANBU_RAID_MIN_LEVEL}.`}</p>
        {obsidian && <p className='stronghold-reward-detail'><b>1.5× normal Ryo and Jutsu XP on PvP wins.</b> The rest of Death’s Gate pays 1.25×. Both fighters must start inside. Patrols do not earn this bonus. Normal reward limits apply.</p>}
        <div className='stronghold-dialog-actions'>
            <button disabled={!admissionOpen || !entryEligible} style={{ padding: '0.55rem 1.15rem', opacity: admissionOpen && entryEligible ? 1 : 0.55 }}
                onClick={() => { if (admissionOpen && entryEligible) onEnter(); }}>
                {!admissionOpen ? 'Operation paused' : specialty ? 'Enter war stronghold' : !entryEligible ? `Requires level ${minimumLevel}` : 'Enter stronghold'}
            </button>
            <button style={{ padding: '0.55rem 1.15rem', opacity: 0.8 }} onClick={onClose}>Stay outside</button>
        </div>
    </StrongholdDialog>;
}

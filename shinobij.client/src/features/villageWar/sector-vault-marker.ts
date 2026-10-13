import type { CampaignFieldMissionView, CampaignView } from '../../../../shared/village-war-campaign';
import { isDeathsGateStronghold, strongholdLevelEligible } from '../../../../shared/sector-stronghold';
import { homeVillageForSector } from '../../data/war-map-sectors';

export function warStrongholdEntryText(campaign: CampaignView | undefined, sector: number, village: string, mission?: CampaignFieldMissionView | null): string | undefined {
    if (!campaign || Date.now() < campaign.startsAt || Date.now() >= campaign.endsAt) return;
    if (mission?.kind === 'espionage' && mission.status === 'active' && mission.sectors[0] === sector)
        return 'Espionage · Enter this enemy stronghold and defeat its ANBU sentry or an enemy player in Shinobi combat to complete your supporting mission.';
    const objective = campaign?.strongholds.find(o => o.sector === sector && o.village !== village);
    if (!objective || !campaign || Date.now() < campaign.startsAt || Date.now() >= campaign.endsAt) return;
    const specialty = { combat: 'Shinobi PvP only', pet: 'Pet battles only', card: 'Card battles only' }[objective.mode];
    return `${specialty}. Enter and attack the ANBU defense to face a queued player or an available ANBU in this battle type. Human victories earn 50 War Points. ANBU victories earn supporting points and intel, using your personal Sabotage allowance.`;
}

/** Preserve ordinary vault admission while a discovered war objective supplies its mode-specific interior. */
export function sectorVaultMarker({ campaign, mission, sector, village, level, anbuViewOpen, ownerVillage, onOpen }: {
    campaign?: CampaignView; mission?: CampaignFieldMissionView | null; sector: number; village: string; level: number; anbuViewOpen: boolean;
    ownerVillage?: string; onOpen: (target: { sector: number; village: string; warEntry?: boolean }) => void;
}) {
    if (!anbuViewOpen) return null;
    const active = !!campaign && Date.now() >= campaign.startsAt && Date.now() < campaign.endsAt;
    if (active && level >= 15 && mission?.kind === 'espionage' && mission.status === 'active' && mission.sectors[0] === sector)
        return { village: mission.enemy, onOpen: () => onOpen({ sector, village: mission.enemy, warEntry: true }) };
    const objective = campaign?.strongholds.find(o => o.sector === sector && o.village !== village);
    if (active && objective && level >= 15) return { village: objective.village!, onOpen: () => onOpen({ sector, village: objective.village!, warEntry: true }) };
    if (isDeathsGateStronghold(sector)) return strongholdLevelEligible(level) ? { village: 'Death’s Gate', obsidian: true, onOpen: () => onOpen({ sector, village: 'Death’s Gate' }) } : null;
    const owner = ownerVillage || homeVillageForSector(sector);
    if (!owner) return null;
    if (active && owner === village) {
        if (level < 15 || campaign.strongholds.some(o => o.sector === sector)) return null;
        return { village: owner, defending: true, onOpen: () => onOpen({ sector, village: owner, warEntry: true }) };
    }
    if (!strongholdLevelEligible(level)) return null;
    return { village: owner, onOpen: () => onOpen({ sector, village: owner }) };
}

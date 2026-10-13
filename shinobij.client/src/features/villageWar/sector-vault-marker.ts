import type { CampaignView } from '../../../../shared/village-war-campaign';
import { isDeathsGateStronghold } from '../../../../shared/sector-stronghold';
import { homeVillageForSector } from '../../data/war-map-sectors';

export function warStrongholdEntryText(campaign: CampaignView | undefined, sector: number, village: string): string | undefined {
    const objective = campaign?.strongholds.find(o => o.sector === sector && o.village !== village);
    if (!objective || !campaign || Date.now() < campaign.startsAt || Date.now() >= campaign.endsAt) return;
    const specialty = { combat: 'Shinobi PvP only', pet: 'Pet battles only', card: 'Card battles only' }[objective.mode];
    return `${specialty}. Enter and attack the ANBU defense to face a queued player or an available ANBU in this battle type. Human victories earn 50 War Points. ANBU victories earn supporting points and intel, using your personal Sabotage allowance.`;
}

/** Preserve ordinary vault admission while a discovered war objective supplies its mode-specific interior. */
export function sectorVaultMarker({ campaign, sector, village, level, anbuViewOpen, ownerVillage, onOpen }: {
    campaign?: CampaignView; sector: number; village: string; level: number; anbuViewOpen: boolean;
    ownerVillage?: string; onOpen: (target: { sector: number; village: string }) => void;
}) {
    const objective = campaign?.strongholds.find(o => o.sector === sector && o.village !== village);
    if (objective && level >= 15) return { village: objective.village!, onOpen: () => onOpen({ sector, village: objective.village! }) };
    if (isDeathsGateStronghold(sector)) return { village: 'Death’s Gate', obsidian: true, onOpen: () => onOpen({ sector, village: 'Death’s Gate' }) };
    if (!anbuViewOpen) return null;
    const owner = ownerVillage || homeVillageForSector(sector);
    if (!owner) return null;
    if (owner === village) {
        if (level < 15 || !campaign || Date.now() < campaign.startsAt || Date.now() >= campaign.endsAt
            || campaign.strongholds.some(o => o.sector === sector)) return null;
    } else if (level < 100) return null;
    return { village: owner, defending: owner === village, onOpen: () => onOpen({ sector, village: owner }) };
}

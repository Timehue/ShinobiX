import type { CampaignView, CampaignObjective, CampaignFieldMissionView } from '../../../shared/village-war-campaign';
import type { Character, PlayerRecord } from '../types/character';
import type { SoloPveSession } from './solo-pve-api';
import type { ChronicleProjection } from './chronicle-duel';
import type { Pet } from '../types/pet';
export type CampaignBattle = {
    runId: string; mode: 'combat' | 'pet' | 'card'; npc: boolean;
    status: 'prepared' | 'active' | 'done'; battleId?: string;
    session?: SoloPveSession | ChronicleProjection | CampaignPetSession;
    warResult?: { scored: boolean; points: number }; _saveVersion?: number; character?: Character;
};
export type CampaignPetSession = { status: 'active' | 'done'; winner: 'p1' | 'p2';
    p1: { name: string; pet: Pet }; p2: { name: string; pet: Pet }; seed: number };
export type CampaignResponse = CampaignBattle & { campaign?: CampaignView;
    mission?: CampaignFieldMissionView | null; peers?: PlayerRecord[]; guard?: { sector: number; inside: boolean };
    room?: { objective: CampaignObjective; serverNow: number;
        players: { name: string; displayName: string; village: string; tile: number; inBattle: boolean }[] };
    defense?: { objectiveId: string; seenAt: number }; run?: CampaignBattle | null; error?: string };
export async function campaignRequest(name: string, warId: string, action: string, extra: Record<string, unknown> = {}): Promise<CampaignResponse> {
    const response = await fetch('/api/village/war-campaign', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, warId, action, ...extra }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Village war request failed.');
    return data;
}
export async function currentVillageCampaign(name: string, village: string): Promise<{ warId: string; response: CampaignResponse } | null> {
    const response = await fetch('/api/world-state');
    if (!response.ok) throw new Error('Could not load village wars.');
    const data = await response.json() as { wars?: { id: string; villages: string[]; endedAt?: number; campaignVersion?: number }[] };
    const war = data.wars?.find(w => !w.endedAt && w.campaignVersion === 2 && w.villages.includes(village));
    return war ? { warId: war.id, response: await campaignRequest(name, war.id, 'view') } : null;
}

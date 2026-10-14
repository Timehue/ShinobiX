import { useCallback, useEffect, useState } from 'react';
import type { CampaignView, CampaignFieldMissionView } from '../../../shared/village-war-campaign';
import { currentVillageCampaign } from './village-war-campaign';
import { visiblePoll } from './poll';
export type VillageCampaignState = { warId: string; campaign: CampaignView; mission?: CampaignFieldMissionView | null } | null;
/**
 * The player's village war campaign, polled every 20 s. `initial` is a reading
 * another poller already holds (the World Map's): a stronghold opened from the
 * map starts from it instead of waiting on its own first request, and still
 * refreshes at once in the background.
 */
export function useVillageCampaign(name: string, village: string, initial?: { state: VillageCampaignState; loaded: boolean }) {
    const [state, setState] = useState<VillageCampaignState>(() => initial?.loaded ? initial.state : null);
    const [loaded, setLoaded] = useState(() => initial?.loaded === true);
    const refresh = useCallback(async () => {
        try {
            const result = await currentVillageCampaign(name, village);
            const next: VillageCampaignState = result?.response.campaign ? { warId: result.warId, campaign: result.response.campaign, mission: result.response.mission } : null;
            // An unchanged reading keeps its identity, so a live war does not
            // re-render the whole World Map every 20 s for nothing.
            setState(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        } finally { setLoaded(true); }
    }, [name, village]);
    useEffect(() => visiblePoll(() => refresh().catch(() => undefined), 20_000, .1, { immediate: true }), [refresh]);
    return { state, loaded };
}

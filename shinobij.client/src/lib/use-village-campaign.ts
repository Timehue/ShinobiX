import { useCallback, useEffect, useState } from 'react';
import type { CampaignView, CampaignFieldMissionView } from '../../../shared/village-war-campaign';
import { currentVillageCampaign } from './village-war-campaign';
import { visiblePoll } from './poll';
export function useVillageCampaign(name: string, village: string) {
    const [state, setState] = useState<{ warId: string; campaign: CampaignView; mission?: CampaignFieldMissionView | null } | null>(null);
    const [loaded, setLoaded] = useState(false);
    const refresh = useCallback(async () => {
        try {
            const result = await currentVillageCampaign(name, village);
            setState(result?.response.campaign ? { warId: result.warId, campaign: result.response.campaign, mission: result.response.mission } : null);
        } finally { setLoaded(true); }
    }, [name, village]);
    useEffect(() => visiblePoll(() => refresh().catch(() => undefined), 20_000, .1, { immediate: true }), [refresh]);
    return { state, loaded };
}

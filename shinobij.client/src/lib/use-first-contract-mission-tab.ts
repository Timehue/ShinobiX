import { useEffect, useState, useSyncExternalStore } from 'react';
import { readFirstContract } from '../../../shared/first-contract';
import type { Character } from '../types/character';
import { acknowledgeFirstContractMissionRequest, firstContractMissionRequest, hasFirstContractMissionRequest, subscribeFirstContractMissions } from './first-contract-navigation';

type MissionTab = 'profession' | 'combat' | 'field' | 'weekly' | 'wandering';
export function useFirstContractMissionTab(character: Character) {
    const request = useSyncExternalStore(subscribeFirstContractMissions, () => firstContractMissionRequest(character.name), () => 0);
    const contract = readFirstContract(character.firstContract);
    const [choice, setChoice] = useState<{ request: number; tab: MissionTab }>(() => ({
        request,
        tab: hasFirstContractMissionRequest(character.name) || (contract?.route === 'combat' && !contract.acknowledgedAt) || !character.profession ? 'combat' : 'profession',
    }));
    useEffect(() => { acknowledgeFirstContractMissionRequest(character.name, request); }, [character.name, request]);
    // An explicit journal handoff wins once. Manual tab selection remains usable.
    const activeTab = choice.request === request ? choice.tab : 'combat';
    const setActiveTab = (tab: MissionTab) => setChoice({ request, tab });
    return [activeTab, setActiveTab] as const;
}

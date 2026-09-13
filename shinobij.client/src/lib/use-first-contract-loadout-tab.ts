import { useEffect, useState, useSyncExternalStore } from 'react';
import { readFirstContract } from '../../../shared/first-contract';
import type { Character } from '../types/character';
import { firstContractPreparation } from './first-contract';
import { acknowledgeFirstContractLoadoutRequest, firstContractLoadoutRequest, hasFirstContractLoadoutRequest, subscribeFirstContractLoadout } from './first-contract-loadout-navigation';

export function useFirstContractLoadoutTab<T extends string>(character: Character, consumer: 'profile' | 'workspace', initial: T, target: T) {
    const request = useSyncExternalStore(subscribeFirstContractLoadout, () => firstContractLoadoutRequest(character.name), () => 0);
    const [choice, setChoice] = useState(() => {
        const contract = readFirstContract(character.firstContract);
        const resumePreparation = contract?.route === 'combat' && !contract.acknowledgedAt && firstContractPreparation(character, 'combat')?.screen === 'profile';
        return { request, tab: hasFirstContractLoadoutRequest(character.name, consumer) || resumePreparation ? target : initial };
    });
    useEffect(() => { acknowledgeFirstContractLoadoutRequest(character.name, consumer, request); }, [character.name, consumer, request]);
    // A new explicit handoff wins once, including in an already mounted screen.
    // Manual choices remain usable until the player requests preparation again.
    const tab = choice.request === request ? choice.tab : target;
    return [tab, (next: T) => setChoice({ request, tab: next })] as const;
}

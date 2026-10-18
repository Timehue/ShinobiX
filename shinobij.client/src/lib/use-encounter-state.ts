import { useRef, useState } from 'react';

/** A synchronous reservation beside React state keeps async encounter callbacks
 * from claiming the same screen before React commits the first presentation. */
export function useEncounterState<T>() {
    const [encounter, setState] = useState<T | null>(null);
    const current = useRef<T | null>(null);
    const setEncounter = (value: T | null) => {
        current.current = value;
        setState(value);
    };
    return [encounter, setEncounter, current] as const;
}

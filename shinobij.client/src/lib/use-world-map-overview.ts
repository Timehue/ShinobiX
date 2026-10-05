import { useCallback, useEffect, useRef } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";

type Navigate = (screen: Screen, character?: Character, options?: { worldMapOverview?: boolean }) => boolean;

export function useWorldMapOverview(navigate: Navigate): () => void {
    const navigateRef = useRef(navigate);
    useEffect(() => { navigateRef.current = navigate; }, [navigate]);
    return useCallback(() => navigateRef.current("worldMap", undefined, { worldMapOverview: true }), []);
}

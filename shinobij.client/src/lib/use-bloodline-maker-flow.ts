import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import type { SavedBloodline } from "../types/combat";
import type { Rank, Screen } from "../types/core";

type ScreenSetter = Dispatch<SetStateAction<Screen>>;
type AwakeningRequestSetter = Dispatch<SetStateAction<boolean>>;

export function useBloodlineMakerFlow(
    setScreen: ScreenSetter,
    setAcademyAwakeningRequested: AwakeningRequestSetter,
) {
    const [initialRank, setInitialRank] = useState<Rank>("A Rank");
    const [initialElement, setInitialElement] = useState("");
    const [rankLocked, setRankLocked] = useState(false);
    const [editingBloodline, setEditingBloodline] = useState<SavedBloodline | null>(null);

    const open = useCallback((rank: Rank, element: string) => {
        setInitialRank(rank);
        setInitialElement(element);
        setRankLocked(true);
        setEditingBloodline(null);
        setScreen("bloodlineMaker");
    }, [setScreen]);

    const edit = useCallback((bloodline: SavedBloodline) => {
        setEditingBloodline(bloodline);
        setInitialRank(bloodline.rank);
        setInitialElement(bloodline.specialElement ?? "");
        setRankLocked(false);
        setScreen("bloodlineMaker");
    }, [setScreen]);

    const close = useCallback((returnScreen: Screen) => {
        setRankLocked(false);
        setEditingBloodline(null);
        setScreen(returnScreen);
    }, [setScreen]);

    const openAwakening = useCallback(() => {
        setRankLocked(false);
        setEditingBloodline(null);
        setAcademyAwakeningRequested(true);
        setScreen("centralHub");
    }, [setAcademyAwakeningRequested, setScreen]);

    return { initialRank, initialElement, rankLocked, editingBloodline, open, edit, close, openAwakening };
}

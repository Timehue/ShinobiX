import type { Dispatch, SetStateAction } from "react";
import type { Character } from "../types/character";
import { useGuardDutyRefresh } from "../lib/use-guard-duty-refresh";

/**
 * Keeps a Village Guard sign-up alive (lib/use-guard-duty-refresh.ts). App
 * loads this lazily and renders it only while the player is on duty, so the
 * startup graph, which has almost no gzip budget left, pays nothing for it.
 */
export function GuardDutyRefresher({ character, setCharacter, notify }: {
    character: Character;
    setCharacter: Dispatch<SetStateAction<Character | null>>;
    notify: (message: string) => void;
}) {
    useGuardDutyRefresh(character, setCharacter, notify);
    return null;
}

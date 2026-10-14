import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Character, PlayerRecord } from "../types/character";
import { isIdleVitalsOnlyChange } from "./loaded-vitals";

/**
 * Keeps the viewer's own row at the head of the local player roster (moved out
 * of App unchanged, apart from the throttle).
 *
 * An idle-regen tick only raises vitals, which screens read from `character`,
 * not from this row. Refreshing the row on every tick re-rendered the whole App
 * twice a second, so a tick refreshes it at most every 15 s. Any other change,
 * and any change of sector, still refreshes it at once.
 */
export function useSelfRosterRow(character: Character | null, currentSector: number,
    setPlayerRoster: Dispatch<SetStateAction<PlayerRecord[]>>) {
    const last = useRef<{ seen: Character | null; sector: number; at: number }>({ seen: null, sector: 0, at: 0 });
    useEffect(() => {
        if (!character) return;
        const self = last.current, seen = self.seen;
        self.seen = character;
        if (seen && self.sector === currentSector && Date.now() - self.at < 15_000 && isIdleVitalsOnlyChange(seen, character)) return;
        Object.assign(self, { sector: currentSector, at: Date.now() });
        setPlayerRoster((current) => {
            const record: PlayerRecord = {
                name: character.name,
                level: character.level,
                village: character.village,
                specialty: character.specialty,
                character,
                currentSector,
                lastSeenAt: Date.now(),
            };
            return [record, ...current.filter((player) => player.name !== character.name)].slice(0, 30);
        });
    }, [character, currentSector, setPlayerRoster]);
}

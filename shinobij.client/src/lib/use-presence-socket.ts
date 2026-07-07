import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { Character } from "../types/character";
import { presenceCharacter } from "./presence-character";
import type { PresenceFrame } from "./presence-socket";
import {
    getLocalSectorTile,
    pushLiveSectorPlayers,
    removeLiveSectorPlayers,
    resetLiveSectorPlayers,
} from "./presence-store";

type PresenceSocketApi = typeof import("./presence-socket");

let presenceSocketApi: PresenceSocketApi | null = null;
let presenceSocketLoad: Promise<PresenceSocketApi> | null = null;

function loadPresenceSocket(): Promise<PresenceSocketApi> {
    if (!presenceSocketLoad) {
        presenceSocketLoad = import("./presence-socket").then((api) => {
            presenceSocketApi = api;
            return api;
        });
    }
    return presenceSocketLoad;
}

export function updateRealtimePresence(frame: PresenceFrame): void {
    presenceSocketApi?.updatePresence(frame);
}

type UsePresenceSocketOptions = {
    characterName?: string;
    characterRef: MutableRefObject<Character | null>;
    currentSectorRef: MutableRefObject<number>;
    heartbeatRef: MutableRefObject<() => void>;
    getPresenceBattleActive: () => boolean;
    setSocketConnected: (connected: boolean) => void;
};

export function usePresenceSocket({
    characterName,
    characterRef,
    currentSectorRef,
    heartbeatRef,
    getPresenceBattleActive,
    setSocketConnected,
}: UsePresenceSocketOptions): void {
    const getPresenceBattleActiveRef = useRef(getPresenceBattleActive);

    useEffect(() => {
        getPresenceBattleActiveRef.current = getPresenceBattleActive;
    }, [getPresenceBattleActive]);

    useEffect(() => {
        if (!characterName) return;
        const char = characterRef.current;
        if (!char) return;

        const initialFrame: PresenceFrame = {
            sector: currentSectorRef.current,
            character: presenceCharacter(char),
            travelingUntil: 0,
            inBattle: getPresenceBattleActiveRef.current(),
            displayName: char.name,
            tile: getLocalSectorTile(),
        };
        let alive = true;
        let cleanup = () => {};

        void loadPresenceSocket().then((api) => {
            if (!alive) return;
            api.connectRealtime(initialFrame);
            const offStatus = api.onStatus((connected) => setSocketConnected(connected));
            const offSector = api.onSector((sector, players) => {
                if (sector === currentSectorRef.current) pushLiveSectorPlayers(players, sector);
            });
            const offGone = api.onGone((names) => {
                removeLiveSectorPlayers(names);
            });
            const offKick = api.onKick(() => {
                heartbeatRef.current();
            });
            cleanup = () => {
                offStatus();
                offSector();
                offGone();
                offKick();
                api.disconnectRealtime();
            };
        }).catch(() => {
            /* Heartbeat keeps presence working if the socket chunk fails. */
        });

        return () => {
            alive = false;
            cleanup();
            resetLiveSectorPlayers();
            setSocketConnected(false);
        };
    }, [characterName, characterRef, currentSectorRef, heartbeatRef, setSocketConnected]);
}

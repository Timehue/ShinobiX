import { useCallback, useEffect, useRef, useState } from "react";
import type { CoastFloor } from "../../../../shared/coast-world-rules";
import { dutyOrder } from "../../../../shared/coast-duty-order";
import type { RoomDuty, RoomDutyCommand, RoomDutyProgress } from "../../../../shared/coast-room-duties";
import type { CoastSite } from "../../lib/quest-lines-api";
import { roomDutyRequest } from "../../lib/quest-lines-api";
import type { VersionedCharacterCommit } from "../../types/character";
import { neighbours, open } from "./coast-grid";

function oldNotebook(player: string) {
    const legacy: Record<string, number> = {};
    try {
        const prefix = "coastRoomDuty.v1:" + player.toLowerCase() + ":";
        for (let index = 0; index < localStorage.length; index++) {
            const key = localStorage.key(index);
            if (!key?.startsWith(prefix)) continue;
            const tick = Number(localStorage.getItem(key));
            if (Number.isSafeInteger(tick) && tick > 0) legacy[key.slice(prefix.length)] = tick;
        }
    } catch { /* Character progress is available even when local storage is disabled. */ }
    return legacy;
}

export function useRoomDuty(building: CoastSite | undefined, player: string, commit?: VersionedCharacterCommit) {
    const site = building?.id, duty = building?.workshop;
    const [progress, setProgress] = useState<RoomDutyProgress>();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const inFlight = useRef(false);
    const owner = useRef<object | null>(null);
    const onCharacter = useRef(commit);
    useEffect(() => { onCharacter.current = commit; }, [commit]);

    const send = useCallback(async (command: RoomDutyCommand, data: Parameters<typeof roomDutyRequest>[3]) => {
        const identity = owner.current;
        if (!site || !identity || inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
            const reply = await roomDutyRequest(player, site, command, data);
            if (owner.current !== identity) return;
            if (!reply.ok || !reply.progress) { setError(reply.error ?? "Your request could not be updated. Try again."); return; }
            if (reply.character) onCharacter.current?.(reply.character, reply._saveVersion);
            setProgress(reply.progress);
        } finally {
            if (owner.current === identity) { inFlight.current = false; setBusy(false); }
        }
    }, [site, player]);
    const sync = useCallback(() => { void send("sync", { legacy: oldNotebook(player) }); }, [player, send]);
    useEffect(() => {
        if (!duty) return;
        owner.current = {};
        inFlight.current = false;
        sync();
        window.addEventListener("focus", sync);
        return () => { owner.current = null; window.removeEventListener("focus", sync); };
    }, [duty, sync]);

    if (!duty || !site) return;
    const tick = progress?.tick ?? 0, stage = tick % 4, edition = Math.floor(tick / 4);
    const variant = dutyOrder(duty, progress), card = duty.cases[variant];
    return {
        site, variant, duty, stage, card, sample: progress?.bench?.value, ready: !!progress, busy, error, sync,
        paid: stage === 3 && progress?.paidTick === tick, completed: edition + Number(stage === 3),
        station: stage === 1 ? duty.inspect : stage === 2 ? duty.operate : undefined,
        take: () => { if (progress) void send("take", { tick }); },
        inspect: (station: string) => { if (stage === 1 && station === duty.inspect) void send("inspect", { tick, station }); },
        adjust: (answer: string | number) => { if (stage === 2) void send("adjust", { tick, station: duty.operate, revision: progress?.bench?.revision ?? 0, answer }); },
        deliver: (answer: string | number) => { if (stage === 2) void send("deliver", { tick, station: duty.operate, revision: progress?.bench?.revision ?? 0, answer }); },
    };
}

export function dutyFloor(floors: CoastFloor[], station: string) {
    return floors.findIndex(floor => floor.stations.some(entry => entry.name === station));
}

export function dutyAttendantTile(room: CoastFloor, duty: RoomDuty) {
    const source = room.stations.find(station => station.name === duty.inspect);
    if (!source) return;
    // Leave the hotspot, stairs and spawn clear. Place the attendant beside the
    // station, on painted walkable ground reachable from its approach.
    const reserved = new Set([room.spawn, ...room.doors, ...room.stairs.map(s => s.tile), ...room.stations.map(s => s.approach)]);
    return neighbours(source.approach).find(tile => !reserved.has(tile) && open(room.mask, tile));
}

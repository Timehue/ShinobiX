import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Character } from "../types/character";
import type { CreatorEvent } from "../types/vn";
import { loadStoryTrigger } from "./story-trigger-loader";
import { nextNarrativeDelivery } from "./story-history";
import { acknowledgeStoryReport, nextPendingStoryReport, recordStoryReportConflict } from "./story-history-mutations";

/** Retry narrative bookkeeping and recover a pending zero-reward aftermath. */
export function useStoryDelivery({
    character,
    activeEvent,
    blocked,
    triggeredEvents,
    accountIsCurrent,
    setCharacter,
    openEpilogue,
}: {
    character: Character | null;
    activeEvent: CreatorEvent | null;
    blocked: boolean;
    triggeredEvents: string[];
    accountIsCurrent: (name: string) => boolean;
    setCharacter: Dispatch<SetStateAction<Character | null>>;
    openEpilogue: (event: CreatorEvent) => void;
}) {
    const inFlight = useRef(new Set<string>());
    const [retry, setRetry] = useState(0);
    const accountIsCurrentRef = useRef(accountIsCurrent);
    const openEpilogueRef = useRef(openEpilogue);
    useLayoutEffect(() => {
        accountIsCurrentRef.current = accountIsCurrent;
        openEpilogueRef.current = openEpilogue;
    }, [accountIsCurrent, openEpilogue]);

    useEffect(() => {
        if (!character) return;
        const report = nextPendingStoryReport(character);
        if (!report) return;
        const account = character.name.trim().toLowerCase();
        const key = `${account}:${report.kind}:${report.eventId}:${report.trait}`;
        if (inFlight.current.has(key)) return;
        inFlight.current.add(key);
        const send = report.kind === "interlude"
            ? loadStoryTrigger().then(({ reportStoryInterlude }) => reportStoryInterlude(character, report.eventId, report.trait))
            : import("./story-road-events").then(({ reportStoryRoadEvent }) => reportStoryRoadEvent(character.name, report.eventId, report.trait));
        void send.then((result) => {
            if (result.ok && result.trait === report.trait) {
                setCharacter((current) => current?.name.trim().toLowerCase() === account
                    ? acknowledgeStoryReport(current, report)
                    : current);
            } else if (result.reason === "conflict") {
                setCharacter((current) => current?.name.trim().toLowerCase() === account
                    ? recordStoryReportConflict(current, report, result.recordedTrait)
                    : current);
            } else {
                window.setTimeout(() => setRetry((value) => value + 1), 6_000);
            }
        }).catch(() => window.setTimeout(() => setRetry((value) => value + 1), 6_000))
            .finally(() => inFlight.current.delete(key));
    }, [character, retry, setCharacter]);

    useEffect(() => {
        if (!character || activeEvent || blocked) return;
        const pending = nextNarrativeDelivery(character, triggeredEvents);
        if (!pending) return;
        let stale = false;
        const eventPromise = pending.kind === "epilogue"
            ? loadStoryTrigger().then(({ selectStoryEpilogueEvent }) => selectStoryEpilogueEvent(
                character, pending.receipt.lane, pending.receipt.presentationTraits,
            ))
            : import("./hollow-rifts").then(({ riftFirstClearEvent }) => riftFirstClearEvent(pending.riftId, "shadow"));
        void eventPromise.then((event) => {
            if (stale || !accountIsCurrentRef.current(character.name)) return;
            if (event) openEpilogueRef.current(event);
        }).catch(() => window.setTimeout(() => setRetry((value) => value + 1), 6_000));
        return () => { stale = true; };
    }, [activeEvent, blocked, character, retry, triggeredEvents]);
}

export function StoryDeliveryHost(props: Parameters<typeof useStoryDelivery>[0]) {
    useStoryDelivery(props);
    return null;
}

import { useEffect, useState, useEffectEvent, type ReactNode } from "react";
import { coastMessage } from "./coast-service";
import { readTownPresence } from "./clan-town-presence";

export function CoastFieldBoundary({ children, resume }: { children: ReactNode; resume: () => void }) {
    const resumeVisit = useEffectEvent(resume);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const [attempt, retry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        readTownPresence(controller.signal).then(inside => {
            if (controller.signal.aborted) return;
            if (inside) resumeVisit();
            else setReady(true);
        }).catch(cause => { if (!controller.signal.aborted) setError(coastMessage(cause)); });
        return () => controller.abort();
    }, [attempt]);
    if (ready) return children;
    return <section aria-live="polite"><p>{error || "Entering the sector…"}</p>
        {error && <button type="button" onClick={() => { setError(""); retry(n => n + 1); }}>Try again</button>}</section>;
}

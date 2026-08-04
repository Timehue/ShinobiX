import { useEffect, useRef, useState } from "react";
import { formatBreedingDuration } from "../lib/pet-breeding";

export function BreedingCountdown({ readyAt, onElapsed }: { readyAt: number; onElapsed: () => void }) {
    const [now, setNow] = useState(0);
    const fired = useRef(false);
    useEffect(() => {
        fired.current = false;
        const id = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(id);
    }, [readyAt]);
    useEffect(() => {
        if (now < readyAt || fired.current) return;
        fired.current = true;
        onElapsed();
    }, [now, onElapsed, readyAt]);
    return <time className="breeding-countdown" dateTime={new Date(readyAt).toISOString()}>{now ? formatBreedingDuration(readyAt - now) : "--:--:--"}</time>;
}

import { serverNow } from './server-clock';

/** Keep committed input and both animation loops on one forward-only timeline.
 * Heartbeat/NTP corrections may advance an attempt, but cannot rewind a throw. */
export function createKunaiElapsedClock(startedAt: number, wallNow = serverNow, steadyNow = () => performance.now()) {
    let elapsed = Math.max(0, wallNow() - startedAt), previous = steadyNow();
    return () => {
        const steady = steadyNow();
        elapsed = Math.max(elapsed + Math.max(0, steady - previous), wallNow() - startedAt);
        previous = steady;
        return elapsed;
    };
}

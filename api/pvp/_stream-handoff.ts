/*
 * Deploy handoff for live PvP streams.
 *
 * Railway replaces a container by starting the new one, routing new
 * connections to it, then sending SIGTERM to the old one. A PvP stream held
 * open on the old process used to stay there until the drain budget ran out and
 * the socket was cut: meanwhile it could not hear moves committed on the new
 * process (write signals are in-process) and caught them only on its 1 s safety
 * poll, and after the cut the client waited before reconnecting.
 *
 * Now gracefulShutdown (server.ts) calls handOffLiveStreams() first. Every open
 * stream sends `event: reconnect` and ends, so each viewer reopens at once and
 * lands on the new process. Streams arriving while this process drains are
 * refused fast (streamsDraining) so they retry against the new one.
 */
const liveStreams = new Set<() => void>();
let draining = false;

/** Register an open stream's handoff. Returns the unregister function. */
export function registerStreamHandoff(handOff: () => void): () => void {
    liveStreams.add(handOff);
    return () => { liveStreams.delete(handOff); };
}

/** Ask every open PvP stream to move to the new server. Returns how many were asked. */
export function handOffLiveStreams(): number {
    draining = true;
    const streams = [...liveStreams];
    liveStreams.clear();
    for (const handOff of streams) {
        try { handOff(); } catch { /* one stream must not stop the rest */ }
    }
    return streams.length;
}

/** True once this process has started handing its streams off. */
export function streamsDraining(): boolean {
    return draining;
}

/** Test-only. */
export function __resetStreamHandoffForTest(): void {
    liveStreams.clear();
    draining = false;
}

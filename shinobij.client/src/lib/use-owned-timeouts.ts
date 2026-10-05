import { useEffect, useState } from 'react';
import { createOwnedTimeouts } from './owned-timeouts';

export function useOwnedTimeouts() {
    const [timers] = useState(() => createOwnedTimeouts((run, ms) => window.setTimeout(run, ms), id => window.clearTimeout(id)));
    useEffect(() => () => timers.clear(), [timers]);
    return timers;
}

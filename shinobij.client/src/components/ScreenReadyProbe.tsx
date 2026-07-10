import { useEffect } from "react";

import { notifyScreenReady } from "../lib/perfTelemetry";
import type { Screen } from "../types/core";

/** Commits only after the surrounding Suspense boundary has real screen content. */
export function ScreenReadyProbe({ screen }: { screen: Screen }) {
    useEffect(() => { notifyScreenReady(screen); }, [screen]);
    return null;
}

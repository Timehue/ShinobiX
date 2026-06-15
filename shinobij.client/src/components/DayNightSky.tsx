/*
 * DayNightSky — a soft, self-updating colour-wash + vignette that tints any
 * scene to the player's real local time of day (see lib/day-cycle.ts). Drop it
 * inside a `position:relative` container (sector view, village, world map) and
 * the scene glides through dawn → day → dusk → night over the real clock.
 *
 * Pure decoration: two absolutely-positioned divs, pointer-events:none, $0, no
 * assets. The clock is read in an effect/interval (never during render) so the
 * component stays render-pure. It re-reads every 60s — the sky changes slowly,
 * so that's plenty — and pauses while the tab is hidden.
 *
 * The tint sits at z-index 2 by default (it washes the painted backdrop + depth
 * layers but leaves the hero avatar, particles and markers crisp on top). Pass a
 * `className` to re-slot it (e.g. below z-4 village/world markers).
 */
import { useEffect, useState } from "react";
import { skyNow, dayCycleDisabled, NOON_SKY, type SkyState } from "../lib/day-cycle";

export function DayNightSky({
    intensity = 1,
    className,
}: {
    /** scales the whole effect (0–1.5). Lower on the world map / behind menus. */
    intensity?: number;
    className?: string;
}) {
    // Start from a neutral noon sky so render never touches the clock; the mount
    // effect immediately swaps in the real local sky. The disable check is a plain
    // localStorage read in render (same gate pattern as SectorScene3D) — kept out
    // of state so the effect never calls setState synchronously.
    const [sky, setSky] = useState<SkyState>(NOON_SKY);
    const disabled = dayCycleDisabled();

    useEffect(() => {
        if (dayCycleDisabled()) return;
        let timer = 0;
        const apply = () => setSky(skyNow(new Date()));
        apply();
        const start = () => { if (!timer) timer = window.setInterval(apply, 60_000); };
        const stop = () => { if (timer) { window.clearInterval(timer); timer = 0; } };
        start();
        const onVis = () => { if (document.hidden) stop(); else { apply(); start(); } };
        document.addEventListener("visibilitychange", onVis);
        return () => { stop(); document.removeEventListener("visibilitychange", onVis); };
    }, []);

    if (disabled) return null;

    const a = sky.tintAlpha * intensity;
    const vig = sky.vignette * intensity;

    return (
        <div className={"day-night-sky" + (className ? " " + className : "")} aria-hidden="true">
            <div
                className="day-night-tint"
                style={{ background: sky.tint, opacity: a }}
            />
            <div
                className="day-night-vignette"
                style={{
                    opacity: vig,
                    // a faint cool/warm rim from the top so dusk/night read as
                    // light leaving the sky rather than a flat grey dim.
                    background:
                        `linear-gradient(180deg, ${sky.tint} 0%, transparent 26%),` +
                        `radial-gradient(120% 90% at 50% 8%, transparent 40%, rgba(4,6,16,0.66) 100%)`,
                }}
            />
        </div>
    );
}

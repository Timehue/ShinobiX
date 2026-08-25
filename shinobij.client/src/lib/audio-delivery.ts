/*
 * audio-delivery — one place that decides which audio file this browser gets.
 *
 * WebKit (Safari, and every browser on iOS) decodes NO Ogg container at all —
 * neither Vorbis nor Opus. Verified against a real WebKit build, not assumed:
 *
 *   webkit     oggVorbis:(no)      oggOpus:(no)       aac:probably  mp3:probably
 *   chromium   oggVorbis:probably  oggOpus:probably   aac:probably  mp3:probably
 *
 * Two consequences the game has to handle, and they pull in opposite directions:
 *
 *  - SFX/ambience masters are .wav. Ogg Vorbis is the best delivery format for
 *    them because it is GAPLESS — a decode round-trip returns the master's exact
 *    sample count, which matters because game-audio.ts loops the 10-12 s
 *    ambience beds with `source.loop = true`. AAC would add ~640 samples of
 *    decoder priming to every wrap. So: Vorbis first, AAC only when Ogg is out.
 *
 *  - Music is already authored as .ogg. On WebKit those files are simply silent,
 *    so the eight tracks under public/music were inaudible on iPhone and iPad.
 *    Each now has an .m4a sibling; WebKit takes that instead.
 *
 * Probes are computed once and cached — canPlayType forces a codec-registry
 * lookup, and these run on every cue.
 */

type PlayableProbe = { ogg: boolean; aac: boolean };

let probed: PlayableProbe | undefined;

function probe(): PlayableProbe {
    if (probed) return probed;
    // Default to "no compressed format" so a non-DOM context (unit tests, SSR)
    // keeps whatever the caller authored rather than rewriting it to something
    // that may not exist.
    probed = { ogg: false, aac: false };
    try {
        const el = document.createElement("audio");
        // canPlayType answers "probably" | "maybe" | "" — any non-empty string
        // means usable, and "maybe" is the honest answer to a bare codec probe.
        probed = {
            ogg: Boolean(el.canPlayType('audio/ogg; codecs="vorbis"')),
            aac: Boolean(el.canPlayType('audio/mp4; codecs="mp4a.40.2"')),
        };
    } catch {
        // No DOM — keep the conservative default.
    }
    return probed;
}

/** Test seam: forget the cached probe so a test can install its own stub. */
export function resetAudioDeliveryProbe(): void {
    probed = undefined;
}

/**
 * Delivery file for a `.wav` SFX/ambience master. Prefers gapless Vorbis, falls
 * back to AAC on WebKit, and finally to the shipped master so a browser that
 * decodes neither — or a deploy missing the siblings — still gets sound.
 */
export function sfxDeliveryPath(masterPath: string): string {
    const { ogg, aac } = probe();
    if (ogg) return masterPath.replace(/\.wav$/, ".ogg");
    if (aac) return masterPath.replace(/\.wav$/, ".m4a");
    return masterPath;
}

/**
 * Delivery file for an authored `.ogg` music track. Only WebKit is redirected,
 * to the .m4a sibling; everyone else keeps the original file, so this cannot
 * regress a browser that was already playing the music.
 */
export function musicDeliverySrc(oggPath: string): string {
    if (!oggPath.endsWith(".ogg")) return oggPath; // .mp3 tracks play everywhere
    const { ogg, aac } = probe();
    if (ogg || !aac) return oggPath;
    return oggPath.replace(/\.ogg$/, ".m4a");
}

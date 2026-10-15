import { CHRONICLE_PAINTED_ART, CHRONICLE_PAINTED_FIGURES } from "./chronicle-painted-art.js";
import type { RequestHandler } from "express";

/** Compatibility URLs for tabs and saved overrides from before the painted refresh.
 * Keep redirects rather than shipping a second set of image bytes. */
export function chronicleLegacyArtTarget(pathname: string): string | undefined {
    const card = /^\/chronicle\/cards\/([a-z0-9-]+)\.webp$/.exec(pathname);
    if (card) {
        const small = card[1].endsWith("-512");
        const id = small ? card[1].slice(0, -4) : card[1];
        if (!Object.hasOwn(CHRONICLE_PAINTED_ART, id)) return undefined;
        const target = CHRONICLE_PAINTED_ART[id];
        return small ? target.replace(/\.webp$/, "-512.webp") : target;
    }
    const figure = /^\/chronicle\/figures\/([a-z0-9-]+)\.webp$/.exec(pathname);
    if (!figure) return undefined;
    const back = figure[1].endsWith("-back");
    const id = back ? figure[1].slice(0, -5) : figure[1];
    if (!Object.hasOwn(CHRONICLE_PAINTED_FIGURES, id)) return undefined;
    return CHRONICLE_PAINTED_FIGURES[id][back ? "back" : "front"];
}

export const chronicleLegacyArtRedirect: RequestHandler = (req, res, next) => {
    const target = chronicleLegacyArtTarget(req.path);
    if (!target) { next(); return; }
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.redirect(302, target);
};

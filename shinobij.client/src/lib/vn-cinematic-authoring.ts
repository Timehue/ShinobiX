import type { CreatorEvent, VnCinematicDirection } from "../types/vn";

export const VN_MODES = ["auto", "cinematic", "classic"] as const;
export const VN_SHOTS = ["wide", "medium", "close", "detail"] as const;
export const VN_FOCUSES = ["left", "right", "center", "speaker"] as const;
export const VN_MOTIONS = ["auto", "none", "push", "pan-left", "pan-right", "drift"] as const;
export const VN_TRANSITIONS = ["auto", "cut", "crossfade", "dip-black", "whiteout", "whip"] as const;
export const VN_TONES = ["neutral", "warm", "cold", "danger", "hollow", "elegy"] as const;
export const VN_ATMOSPHERES = ["auto", "none", "embers", "rain", "snow", "mist", "motes"] as const;
export const VN_ENTRANCES = ["auto", "none", "fade", "left", "right", "rise"] as const;
export const VN_IMPACTS = ["none", "soft", "heavy"] as const;
export const VN_AMBIENCES = ["auto", "none", "village", "road", "interior", "hollow"] as const;
export const VN_CUES = ["none", "title", "paper", "reveal", "omen", "decision", "battle"] as const;

type DirectionKey = keyof VnCinematicDirection;
type DirectionOption = readonly string[];

const DIRECTION_OPTIONS: Partial<Record<DirectionKey, DirectionOption>> = {
    mode: VN_MODES,
    shot: VN_SHOTS,
    focus: VN_FOCUSES,
    backgroundMotion: VN_MOTIONS,
    transition: VN_TRANSITIONS,
    tone: VN_TONES,
    atmosphere: VN_ATMOSPHERES,
    actorEntrance: VN_ENTRANCES,
    impact: VN_IMPACTS,
    ambience: VN_AMBIENCES,
    cue: VN_CUES,
};

export type VnAuthoringIssue = {
    severity: "error" | "warning";
    path: string;
    message: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseVnBackgroundPosition(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const match = value.trim().match(/^(-?\d+(?:\.\d+)?)%\s+(-?\d+(?:\.\d+)?)%$/);
    if (!match) return undefined;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return undefined;
    return `${x}% ${y}%`;
}

export function sanitizeVnDirection(value: unknown): VnCinematicDirection {
    if (!isRecord(value)) return {};
    const result: VnCinematicDirection = {};

    for (const [key, options] of Object.entries(DIRECTION_OPTIONS) as [DirectionKey, DirectionOption][]) {
        const candidate = value[key];
        if (typeof candidate === "string" && options.includes(candidate)) {
            (result as Record<string, unknown>)[key] = candidate;
        }
    }

    const position = parseVnBackgroundPosition(value.backgroundPosition);
    if (position) result.backgroundPosition = position;
    if (typeof value.backgroundImage === "string" && value.backgroundImage.trim()) {
        result.backgroundImage = value.backgroundImage.trim();
    }
    if (typeof value.titleCard === "boolean") result.titleCard = value.titleCard;
    return result;
}

export function compactVnDirection(value: VnCinematicDirection | undefined): VnCinematicDirection | undefined {
    const clean = sanitizeVnDirection(value);
    const compact = Object.fromEntries(
        Object.entries(clean).filter(([, candidate]) => {
            if (candidate === undefined || candidate === "") return false;
            if (candidate === "auto") return false;
            return true;
        }),
    ) as VnCinematicDirection;
    return Object.keys(compact).length ? compact : undefined;
}

function directionIssues(value: unknown, path: string): VnAuthoringIssue[] {
    if (value === undefined) return [];
    if (!isRecord(value)) return [{ severity: "error", path, message: "Cinematic direction must be an object." }];
    const issues: VnAuthoringIssue[] = [];
    for (const [key, options] of Object.entries(DIRECTION_OPTIONS) as [DirectionKey, DirectionOption][]) {
        const candidate = value[key];
        if (candidate !== undefined && (typeof candidate !== "string" || !options.includes(candidate))) {
            issues.push({ severity: "error", path: `${path}.${key}`, message: `Unsupported ${key} value.` });
        }
    }
    if (value.backgroundPosition !== undefined && !parseVnBackgroundPosition(value.backgroundPosition)) {
        issues.push({
            severity: "error",
            path: `${path}.backgroundPosition`,
            message: "Crop must use two percentages between 0 and 100, for example “50% 42%”.",
        });
    }
    return issues;
}

export function validateVnCinematicEvent(event: CreatorEvent): VnAuthoringIssue[] {
    const issues = directionIssues(event.cinematic, "event.cinematic");
    const pages = event.vnPages ?? [];

    pages.forEach((page, pageIndex) => {
        const pagePath = `page ${pageIndex + 1}`;
        issues.push(...directionIssues(page.cinematic, `${pagePath}.cinematic`));
        page.lines?.forEach((line, lineIndex) => {
            issues.push(...directionIssues(line.cinematic, `${pagePath}.line ${lineIndex + 1}.cinematic`));
        });

        const hasBackdrop = Boolean(page.image || page.cinematic?.backgroundImage || event.image || event.cinematic?.backgroundImage);
        if (!hasBackdrop) {
            issues.push({
                severity: "warning",
                path: pagePath,
                message: "No backdrop is configured; playback will use the biome fallback.",
            });
        }

        const actors = [
            { side: "left", name: page.leftName, image: page.leftImage },
            { side: "right", name: page.rightName ?? page.speaker, image: page.rightImage ?? event.avatarImage },
        ];
        for (const actor of actors) {
            const key = actor.name?.trim().toLowerCase();
            if (key && key !== "player" && key !== "narrator" && !actor.image) {
                issues.push({
                    severity: "warning",
                    path: `${pagePath}.${actor.side}`,
                    message: `${actor.name} has no explicit actor image; verify the bundled portrait fallback exists.`,
                });
            }
        }

        for (const [choiceIndex, choice] of (page.choices ?? []).entries()) {
            const choicePath = `${pagePath}.choice ${choiceIndex + 1}`;
            if (!Number.isInteger(choice.nextPage) || choice.nextPage < 0 || choice.nextPage >= pages.length) {
                issues.push({ severity: "error", path: choicePath, message: "Choice target is outside the VN page range." });
            }
            if (choice.nextPage === pageIndex && !choice.conclusion?.trim() && !choice.battle) {
                issues.push({
                    severity: "error",
                    path: choicePath,
                    message: "Unsafe self-loop: add a conclusion/battle or route the choice to another page.",
                });
            }
        }
    });

    return issues;
}

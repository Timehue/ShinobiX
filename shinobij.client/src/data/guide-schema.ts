export const GUIDE_CATEGORIES = [
    "Start Here",
    "Build Your Shinobi",
    "World & Community",
    "Companions & Collections",
    "Harder Challenges",
    "Game",
] as const;

export const GUIDE_ASSET_IDS = [
    "fieldManual",
    "combat",
    "companion",
    "world",
    "missionHall",
    "forge",
    "townHall",
    "worldMap",
    "chronicle",
    "professions",
    "towers",
    "game",
] as const;

export type GuideCategory = (typeof GUIDE_CATEGORIES)[number];
export type GuideAssetId = (typeof GUIDE_ASSET_IDS)[number];

export type GuideBlock =
    | { type: "p"; text: string }
    | { type: "h"; text: string }
    | { type: "list"; items: string[] }
    | { type: "table"; caption: string; head: string[]; rows: string[][] }
    | { type: "callout"; tone: "tip" | "good" | "warn"; label: string; text: string }
    | { type: "figure"; src: GuideAssetId; alt: string; caption: string; objectPosition?: string };

export type GuideSection = {
    id: string;
    heading: string;
    blocks: GuideBlock[];
};

export type Guide = {
    id: string;
    category: GuideCategory;
    title: string;
    tagline: string;
    blurb: string;
    audience: string;
    readMinutes: number;
    reviewedAt: string;
    hero: GuideAssetId;
    heroAlt: string;
    heroPosition?: string;
    featured?: boolean;
    keywords: string[];
    quickTake: string[];
    relatedGuideIds: string[];
    sections: GuideSection[];
};

type JsonObject = Record<string, unknown>;

const CATEGORIES = new Set<string>(GUIDE_CATEGORIES);
const ASSET_IDS = new Set<string>(GUIDE_ASSET_IDS);
const CALLOUT_TONES = new Set(["tip", "good", "warn"]);

function objectAt(value: unknown, path: string): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    return value as JsonObject;
}

function stringAt(value: unknown, path: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
    return value;
}

function optionalStringAt(value: unknown, path: string): void {
    if (value !== undefined) stringAt(value, path);
}

function stringsAt(value: unknown, path: string): string[] {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
    return value.map((item, index) => stringAt(item, `${path}[${index}]`));
}

function assetAt(value: unknown, path: string): GuideAssetId {
    const asset = stringAt(value, path);
    if (!ASSET_IDS.has(asset)) throw new Error(`${path} uses unknown asset ${asset}`);
    return asset as GuideAssetId;
}

function validateBlock(value: unknown, path: string): void {
    const block = objectAt(value, path);
    const type = stringAt(block.type, `${path}.type`);
    if (type === "p" || type === "h") {
        stringAt(block.text, `${path}.text`);
        return;
    }
    if (type === "list") {
        stringsAt(block.items, `${path}.items`);
        return;
    }
    if (type === "table") {
        stringAt(block.caption, `${path}.caption`);
        stringsAt(block.head, `${path}.head`);
        if (!Array.isArray(block.rows)) throw new Error(`${path}.rows must be an array`);
        block.rows.forEach((row, index) => stringsAt(row, `${path}.rows[${index}]`));
        return;
    }
    if (type === "callout") {
        const tone = stringAt(block.tone, `${path}.tone`);
        if (!CALLOUT_TONES.has(tone)) throw new Error(`${path}.tone is invalid`);
        stringAt(block.label, `${path}.label`);
        stringAt(block.text, `${path}.text`);
        return;
    }
    if (type === "figure") {
        assetAt(block.src, `${path}.src`);
        stringAt(block.alt, `${path}.alt`);
        stringAt(block.caption, `${path}.caption`);
        optionalStringAt(block.objectPosition, `${path}.objectPosition`);
        return;
    }
    throw new Error(`${path}.type is invalid`);
}

function validateGuide(value: unknown, path: string): void {
    const guide = objectAt(value, path);
    for (const field of ["id", "title", "tagline", "blurb", "audience", "reviewedAt", "heroAlt"] as const) {
        stringAt(guide[field], `${path}.${field}`);
    }
    const category = stringAt(guide.category, `${path}.category`);
    if (!CATEGORIES.has(category)) throw new Error(`${path}.category is invalid`);
    assetAt(guide.hero, `${path}.hero`);
    optionalStringAt(guide.heroPosition, `${path}.heroPosition`);
    if (guide.featured !== undefined && typeof guide.featured !== "boolean") throw new Error(`${path}.featured must be boolean`);
    if (!Number.isInteger(guide.readMinutes) || (guide.readMinutes as number) < 1) throw new Error(`${path}.readMinutes must be a positive integer`);
    stringsAt(guide.keywords, `${path}.keywords`);
    const quickTake = stringsAt(guide.quickTake, `${path}.quickTake`);
    if (quickTake.length !== 3) throw new Error(`${path}.quickTake must contain three points`);
    stringsAt(guide.relatedGuideIds, `${path}.relatedGuideIds`);
    if (!Array.isArray(guide.sections) || guide.sections.length === 0) throw new Error(`${path}.sections must be a non-empty array`);
    guide.sections.forEach((sectionValue, sectionIndex) => {
        const sectionPath = `${path}.sections[${sectionIndex}]`;
        const section = objectAt(sectionValue, sectionPath);
        stringAt(section.id, `${sectionPath}.id`);
        stringAt(section.heading, `${sectionPath}.heading`);
        if (!Array.isArray(section.blocks) || section.blocks.length === 0) throw new Error(`${sectionPath}.blocks must be a non-empty array`);
        section.blocks.forEach((block, blockIndex) => validateBlock(block, `${sectionPath}.blocks[${blockIndex}]`));
    });
}

export function parseGuideCatalog(value: unknown): Guide[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error("Guide catalog must be a non-empty array");
    value.forEach((guide, index) => validateGuide(guide, `guides[${index}]`));
    return value as Guide[];
}

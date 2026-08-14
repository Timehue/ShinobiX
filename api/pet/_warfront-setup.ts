import type {
    WfBuildPackage,
    WfCoachOrder,
    WfCounterstrike,
    WfObjectiveTechnique,
    WfOpeningDeployment,
} from '../_pet-sim/pet-warfront-sim.js';
import type { WarfrontAiWarbandId } from './_warfront-ai.js';

export const WARFRONT_DEPLOYMENT_LANES = ['top', 'mid', 'bottom', 'flex'] as const;
export const WARFRONT_BUILD_PACKAGES = ['hold-line', 'blood-hunt', 'escort-rite'] as const;
export const WARFRONT_COACH_ORDERS = ['contest', 'trade', 'ambush'] as const;
export const WARFRONT_OBJECTIVE_TECHNIQUES = ['secure', 'hijack', 'zone'] as const;
export const WARFRONT_COUNTERSTRIKES = ['fortify', 'cross-map', 'bounty-hunt'] as const;

const DEPLOYMENT_LANES = new Set<string>(WARFRONT_DEPLOYMENT_LANES);
const BUILD_PACKAGES = new Set<string>(WARFRONT_BUILD_PACKAGES);
const COACH_ORDERS = new Set<string>(WARFRONT_COACH_ORDERS);
const OBJECTIVE_TECHNIQUES = new Set<string>(WARFRONT_OBJECTIVE_TECHNIQUES);
const COUNTERSTRIKES = new Set<string>(WARFRONT_COUNTERSTRIKES);

export type WarfrontAuthoredSetup = {
    deployment: WfOpeningDeployment;
    buildPackage: WfBuildPackage;
    coachOrder: WfCoachOrder;
    objectiveTechnique: WfObjectiveTechnique;
    counterstrike: WfCounterstrike;
};

/** Neutral legacy plan. It is deterministic and deliberately matches the
 * browser's compatibility projection for challenges created before authored
 * playbooks shipped. New clients always send every field explicitly. */
export const DEFAULT_WARFRONT_AUTHORED_SETUP: WarfrontAuthoredSetup = {
    deployment: ['top', 'mid', 'bottom', 'flex'],
    buildPackage: 'escort-rite',
    coachOrder: 'trade',
    objectiveTechnique: 'secure',
    counterstrike: 'cross-map',
};

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(value, key);

export function isWarfrontOpeningDeployment(value: unknown): value is WfOpeningDeployment {
    return Array.isArray(value)
        && value.length === 4
        && new Set(value).size === 4
        && value.every((lane) => typeof lane === 'string' && DEPLOYMENT_LANES.has(lane));
}

/** Parse the five bounded authored choices. Missing fields receive stable
 * compatibility defaults; an explicitly supplied malformed value is never
 * coerced to a legal choice. */
export function parseWarfrontAuthoredSetup(value: unknown): WarfrontAuthoredSetup | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const raw = value as Record<string, unknown>;

    const deployment = hasOwn(raw, 'deployment') ? raw.deployment : DEFAULT_WARFRONT_AUTHORED_SETUP.deployment;
    const buildPackage = hasOwn(raw, 'buildPackage') ? raw.buildPackage : DEFAULT_WARFRONT_AUTHORED_SETUP.buildPackage;
    const coachOrder = hasOwn(raw, 'coachOrder') ? raw.coachOrder : DEFAULT_WARFRONT_AUTHORED_SETUP.coachOrder;
    const objectiveTechnique = hasOwn(raw, 'objectiveTechnique') ? raw.objectiveTechnique : DEFAULT_WARFRONT_AUTHORED_SETUP.objectiveTechnique;
    const counterstrike = hasOwn(raw, 'counterstrike') ? raw.counterstrike : DEFAULT_WARFRONT_AUTHORED_SETUP.counterstrike;

    if (!isWarfrontOpeningDeployment(deployment)
        || typeof buildPackage !== 'string' || !BUILD_PACKAGES.has(buildPackage)
        || typeof coachOrder !== 'string' || !COACH_ORDERS.has(coachOrder)
        || typeof objectiveTechnique !== 'string' || !OBJECTIVE_TECHNIQUES.has(objectiveTechnique)
        || typeof counterstrike !== 'string' || !COUNTERSTRIKES.has(counterstrike)) return null;

    return {
        deployment: [...deployment] as WfOpeningDeployment,
        buildPackage: buildPackage as WfBuildPackage,
        coachOrder: coachOrder as WfCoachOrder,
        objectiveTechnique: objectiveTechnique as WfObjectiveTechnique,
        counterstrike: counterstrike as WfCounterstrike,
    };
}

export function warfrontAuthoredSetupsEqual(a: WarfrontAuthoredSetup, b: WarfrontAuthoredSetup): boolean {
    return a.deployment.every((lane, index) => lane === b.deployment[index])
        && a.buildPackage === b.buildPackage
        && a.coachOrder === b.coachOrder
        && a.objectiveTechnique === b.objectiveTechnique
        && a.counterstrike === b.counterstrike;
}

/** Readable, deterministic AI identities. These four selections are sealed
 * with the warband and sent back as redSetup so browser replay never infers a
 * different opponent plan. */
export function warfrontAiAuthoredSetup(id: WarfrontAiWarbandId): WarfrontAuthoredSetup {
    if (id === 'sustain') {
        return {
            deployment: [...DEFAULT_WARFRONT_AUTHORED_SETUP.deployment] as WfOpeningDeployment,
            buildPackage: 'hold-line',
            coachOrder: 'contest',
            objectiveTechnique: 'zone',
            counterstrike: 'fortify',
        };
    }
    if (id === 'ambush') {
        return {
            deployment: [...DEFAULT_WARFRONT_AUTHORED_SETUP.deployment] as WfOpeningDeployment,
            buildPackage: 'blood-hunt',
            coachOrder: 'ambush',
            objectiveTechnique: 'hijack',
            counterstrike: 'bounty-hunt',
        };
    }
    return {
        deployment: [...DEFAULT_WARFRONT_AUTHORED_SETUP.deployment] as WfOpeningDeployment,
        buildPackage: 'escort-rite',
        coachOrder: 'trade',
        objectiveTechnique: 'secure',
        counterstrike: 'cross-map',
    };
}

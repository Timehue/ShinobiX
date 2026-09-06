/* Echoes of War witness decisions and battle callbacks.
 *
 * This is the small shared authority contract. Player-facing prose stays in
 * the lazy Echoes story payload; the server imports only stable ids, close
 * encounter gates, and defensive normalizers. */

export const ECHOES_BATTLE_BEATS = [
    "denied-attack",
    "recovered-ground",
    "rebuilt-line",
    "unrecorded",
] as const;

export type EchoesBattleBeat = typeof ECHOES_BATTLE_BEATS[number];

export const ECHOES_WITNESS_ERAS = [
    {
        id: "echoes-age-1",
        closeEncounterId: "echoes-3-aya",
        choices: ["warnings-first", "names-first", "cause-open"],
    },
    {
        id: "echoes-age-2",
        closeEncounterId: "echoes-6-korin",
        choices: ["acts-and-excuses", "who-paid", "duty-open"],
    },
    {
        id: "echoes-age-3",
        closeEncounterId: "echoes-9-lyra",
        choices: ["proof-and-silence", "divided-culpability", "outcome-open"],
    },
    {
        id: "echoes-age-4",
        closeEncounterId: "echoes-10-halden",
        choices: ["repeated-delay", "dependencies-and-harm", "verdict-open"],
    },
] as const;

export type EchoesWitnessEraId = typeof ECHOES_WITNESS_ERAS[number]["id"];
export type EchoesWitnessChoiceId = typeof ECHOES_WITNESS_ERAS[number]["choices"][number];
export type EchoesWitnessChoices = Partial<Record<EchoesWitnessEraId, EchoesWitnessChoiceId>>;

const ERA_BY_ID = new Map(ECHOES_WITNESS_ERAS.map((era) => [era.id, era]));
const ERA_BY_CLOSE = new Map(ECHOES_WITNESS_ERAS.map((era) => [era.closeEncounterId, era]));

export function echoesWitnessEra(value: unknown): typeof ECHOES_WITNESS_ERAS[number] | null {
    return typeof value === "string" ? (ERA_BY_ID.get(value as EchoesWitnessEraId) ?? null) : null;
}

export function echoesWitnessEraForCloseEncounter(value: unknown): typeof ECHOES_WITNESS_ERAS[number] | null {
    return typeof value === "string"
        ? (ERA_BY_CLOSE.get(value as typeof ECHOES_WITNESS_ERAS[number]["closeEncounterId"]) ?? null)
        : null;
}

export function isEchoesWitnessChoice(eraId: unknown, choiceId: unknown): choiceId is EchoesWitnessChoiceId {
    const era = echoesWitnessEra(eraId);
    return !!era && typeof choiceId === "string" && (era.choices as readonly string[]).includes(choiceId);
}

/** Old saves have no map. Malformed or future keys are dropped so the durable
 * record remains bounded to one allowlisted answer per known era. */
export function normalizeEchoesWitnessChoices(value: unknown): EchoesWitnessChoices {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    const out: EchoesWitnessChoices = {};
    for (const era of ECHOES_WITNESS_ERAS) {
        const choiceId = source[era.id];
        if (isEchoesWitnessChoice(era.id, choiceId)) out[era.id] = choiceId;
    }
    return out;
}

export function normalizeEchoesBattleBeat(value: unknown): EchoesBattleBeat {
    return typeof value === "string" && (ECHOES_BATTLE_BEATS as readonly string[]).includes(value)
        ? value as EchoesBattleBeat
        : "unrecorded";
}

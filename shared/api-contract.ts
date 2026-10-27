/** Small, dependency-free runtime contracts shared by the server and browser. */
export class ContractError extends Error {
    constructor(message: string) { super(message); this.name = 'ContractError'; }
}

export function contract<T>(parse: (value: unknown) => T) {
    return {
        parse,
        safeParse(value: unknown): { success: true; data: T } | { success: false; error: string } {
            try { return { success: true, data: parse(value) }; }
            catch (error) {
                if (!(error instanceof ContractError)) throw error;
                return { success: false, error: error.message };
            }
        },
    };
}

export type Contract<T> = ReturnType<typeof contract<T>>;
export type ContractType<C extends Contract<unknown>> = ReturnType<C['parse']>;

export function record(value: unknown, message = 'Expected an object.'): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ContractError(message);
    return value as Record<string, unknown>;
}

export function text(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ContractError(message);
    return value;
}

export function whole(value: unknown, message: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new ContractError(message);
    return value;
}

export function boolean(value: unknown, message: string): boolean {
    if (typeof value !== 'boolean') throw new ContractError(message);
    return value;
}

export function choice<const T extends readonly string[]>(value: unknown, values: T, message: string): T[number] {
    if (typeof value !== 'string' || !values.includes(value)) throw new ContractError(message);
    return value as T[number];
}

/** Validate only the wire envelope. Unknown game fields must survive upgrades. */
export const villageTaxContract = contract((value: unknown) => {
    const body = record(value);
    return {
        ...body,
        applied: boolean(body.applied, 'Invalid tax applied flag.'),
        taxed: whole(body.taxed, 'Invalid tax amount.'),
        toBurn: whole(body.toBurn, 'Invalid burned tax.'),
        toTreasury: whole(body.toTreasury, 'Invalid treasury tax.'),
        ryo: whole(body.ryo, 'Invalid taxed wallet.'),
        bankRyo: whole(body.bankRyo, 'Invalid taxed vault.'),
        ...(body._saveVersion === undefined ? {} : { _saveVersion: whole(body._saveVersion, 'Invalid tax save version.', 1) }),
    };
});

export function taxFields(body: Record<string, unknown>) {
    return body.villageTax === undefined ? {} : { villageTax: villageTaxContract.parse(body.villageTax) };
}

export const apiErrorContract = contract((value: unknown) => {
    const body = record(value);
    if (body.ok !== undefined && body.ok !== false) throw new ContractError('Invalid error acknowledgement.');
    return { ...body, error: text(body.error, 'Missing error message.'), ...taxFields(body) };
});

export function acknowledged(value: unknown) {
    const body = record(value);
    if (body.ok !== true) throw new ContractError('Missing success acknowledgement.');
    return body;
}

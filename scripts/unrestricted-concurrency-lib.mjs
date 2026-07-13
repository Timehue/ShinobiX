export const MUTATION_CONFIRMATION = 'I_UNDERSTAND_THIS_MUTATES_DISPOSABLE_ACCOUNTS';

export function valueAtPath(value, path) {
    if (!path) return value;
    return String(path).split('.').reduce((current, key) => (
        current && typeof current === 'object' ? current[key] : undefined
    ), value);
}

export function validateConcurrencyManifest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Manifest must be a JSON object.');
    if (input.confirmation !== MUTATION_CONFIRMATION) throw new Error('Manifest is missing the disposable-account mutation confirmation.');
    if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) throw new Error('Manifest must include at least one scenario.');
    const names = new Set();
    return input.scenarios.map((raw, index) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Scenario ${index + 1} must be an object.`);
        const name = String(raw.name ?? '').trim();
        const playerName = String(raw.playerName ?? '').trim();
        const token = String(raw.token ?? '').trim();
        const path = String(raw.path ?? '').trim();
        const method = String(raw.method ?? 'POST').toUpperCase();
        const parallel = Math.floor(Number(raw.parallel ?? 2));
        const allowedStatuses = Array.isArray(raw.allowedStatuses)
            ? [...new Set(raw.allowedStatuses.map(Number).filter(Number.isInteger))]
            : [200, 409];
        const mutation = raw.mutation && typeof raw.mutation === 'object' && !Array.isArray(raw.mutation)
            ? { path: String(raw.mutation.path ?? '').trim(), equals: raw.mutation.equals, max: Math.floor(Number(raw.mutation.max ?? 1)), min: Math.floor(Number(raw.mutation.min ?? 1)) }
            : null;
        if (!name || names.has(name)) throw new Error(`Scenario ${index + 1} needs a unique name.`);
        names.add(name);
        if (!playerName || !token) throw new Error(`Scenario ${name} needs playerName and token.`);
        if (!path.startsWith('/api/') || path.includes('://')) throw new Error(`Scenario ${name} path must be a relative /api/ path.`);
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error(`Scenario ${name} must use a mutating HTTP method.`);
        if (!Number.isInteger(parallel) || parallel < 2 || parallel > 25) throw new Error(`Scenario ${name} parallel must be 2..25.`);
        if (allowedStatuses.length === 0) throw new Error(`Scenario ${name} needs allowedStatuses.`);
        if (mutation && (!mutation.path || mutation.min < 0 || mutation.max < mutation.min || mutation.max > parallel)) throw new Error(`Scenario ${name} has an invalid mutation assertion.`);
        return { name, playerName, token, path, method, parallel, allowedStatuses, mutation, body: raw.body ?? {} };
    });
}

export function evaluateConcurrencyResponses(scenario, responses) {
    const transportErrors = responses.filter((response) => response.transportError);
    const unexpected = responses.filter((response) => !response.transportError && !scenario.allowedStatuses.includes(response.status));
    const mutationCount = scenario.mutation
        ? responses.filter((response) => !response.transportError && valueAtPath(response.body, scenario.mutation.path) === scenario.mutation.equals).length
        : null;
    const failures = [];
    if (transportErrors.length) failures.push(`${transportErrors.length} transport error(s)`);
    if (unexpected.length) failures.push(`${unexpected.length} unexpected status response(s)`);
    if (scenario.mutation && (mutationCount < scenario.mutation.min || mutationCount > scenario.mutation.max)) failures.push(`mutation count ${mutationCount} outside ${scenario.mutation.min}..${scenario.mutation.max}`);
    return { ok: failures.length === 0, failures, mutationCount };
}

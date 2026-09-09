export function stringifyServerSavePayload(payload: unknown) {
    return JSON.stringify(payload, (_key, value) => typeof value === "string" && value.startsWith("data:image") ? "" : value);
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Convert request-controlled values into one bounded physical log line.
 * Keeping the replacement visible preserves diagnostic value while preventing
 * forged prefixes, terminal control sequences, and multiline log injection.
 */
export function safeLogValue(value: unknown, maxLength = 240): string {
    const boundedLength = Number.isInteger(maxLength) && maxLength > 0
        ? Math.min(maxLength, 2_000)
        : 240;
    return String(value ?? '')
        .replace(CONTROL_CHARACTERS, '?')
        .slice(0, boundedLength);
}

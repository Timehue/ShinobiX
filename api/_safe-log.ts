const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

// Line breaks are listed explicitly so CodeQL's js/log-injection query recognizes
// this as a CR/LF sanitizing barrier. It does not credit the Unicode-range
// control-character replace alone and would otherwise re-flag every safeLogValue()
// call site. '?' matches the control-character pass, so output is unchanged.
const LINE_BREAKS = /[\r\n]/g;

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
        .replace(LINE_BREAKS, '?')
        .replace(CONTROL_CHARACTERS, '?')
        .slice(0, boundedLength);
}

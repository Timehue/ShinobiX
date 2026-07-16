"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeLogValue = safeLogValue;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Convert request-controlled values into one bounded physical log line.
 * Keeping the replacement visible preserves diagnostic value while preventing
 * forged prefixes, terminal control sequences, and multiline log injection.
 */
function safeLogValue(value, maxLength = 240) {
    const boundedLength = Number.isInteger(maxLength) && maxLength > 0
        ? Math.min(maxLength, 2_000)
        : 240;
    return String(value ?? '')
        .replace(CONTROL_CHARACTERS, '?')
        .slice(0, boundedLength);
}

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const _safe_log_js_1 = require("./_safe-log.js");
(0, node_test_1.default)('safeLogValue keeps request data on one bounded physical line', () => {
    strict_1.default.equal((0, _safe_log_js_1.safeLogValue)('203.0.113.4\r\n[admin] forged'), '203.0.113.4??[admin] forged');
    strict_1.default.equal((0, _safe_log_js_1.safeLogValue)('ok\u001b[31mred'), 'ok?[31mred');
    strict_1.default.equal((0, _safe_log_js_1.safeLogValue)('abcdef', 4), 'abcd');
});
(0, node_test_1.default)('safeLogValue handles non-string and invalid bound values deterministically', () => {
    strict_1.default.equal((0, _safe_log_js_1.safeLogValue)(undefined), '');
    strict_1.default.equal((0, _safe_log_js_1.safeLogValue)(42), '42');
    strict_1.default.equal((0, _safe_log_js_1.safeLogValue)('value', 0), 'value');
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const here = (0, node_path_1.join)(process.cwd(), 'api', 'admin');
function source(name) {
    return (0, node_fs_1.readFileSync)((0, node_path_1.join)(here, name), 'utf8');
}
(0, node_test_1.test)('security, economy, player, and ranked operations require full admin', () => {
    const sensitive = [
        'battle-receipts.ts',
        'beta-metrics.ts',
        'economy.ts',
        'economy-reconcile.ts',
        'ranked-season.ts',
        'legacy.ts',
        'migrate-kv.ts',
        'moderation.ts',
        'player-index-health.ts',
        'players.ts',
        'save-snapshot.ts',
        'server-reset.ts',
    ];
    for (const file of sensitive) {
        strict_1.default.match(source(file), /isFullAdmin\(req\)/, `${file} must require full admin`);
    }
});
(0, node_test_1.test)('content admin stays limited to curation and content diagnostics', () => {
    for (const file of ['bloodline-review.ts', 'item-review.ts', 'asset-report.ts']) {
        strict_1.default.match(source(file), /isAdmin\(req\)/, `${file} should permit content admin`);
    }
    const audit = source('audit-log.ts');
    strict_1.default.match(audit, /domain !== 'content' && !isFullAdmin\(req\)/);
});

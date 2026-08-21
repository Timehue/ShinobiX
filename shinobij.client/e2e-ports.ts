import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// One e2e server port per suite per checkout. CI keeps the historical fixed
// ports (each CI job runs on its own machine, so they never collide). Local
// runs derive a stable per-worktree port instead: concurrent sessions in
// sibling worktrees used to share 127.0.0.1:4183, cross-registering their
// deterministic account names (409s), draining each other's register rate
// budget (429s), and reconnecting to whichever server survived a kill.
const clientRoot = dirname(fileURLToPath(import.meta.url));

// FNV-1a over the checkout path, folded into 0..999.
function worktreeOffset(): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < clientRoot.length; i++) {
        hash ^= clientRoot.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash % 1000;
}

function resolvePort(envVar: string, ciPort: number, localBase: number, label: string): string {
    const override = process.env[envVar];
    if (override) return override;
    if (process.env.CI) return String(ciPort);
    const port = String(localBase + worktreeOffset());
    // Log once from the runner process (workers have TEST_WORKER_INDEX set)
    // so `netstat` debugging knows which port this worktree owns.
    if (!process.env.TEST_WORKER_INDEX) {
        console.log(`[e2e] ${label} server port ${port} for this worktree (override with ${envVar})`);
    }
    return port;
}

// The local bases keep each suite's 1000-port window disjoint from the other
// suites' windows and from the fixed ports of the remaining configs
// (4174 visual/warfront, 4176 adaptive-dpr), so no two suites in any pair of
// worktrees can land on the same port.
export const smokeE2ePort = () => resolvePort('PLAYWRIGHT_PORT', 4173, 14173, 'smoke preview');
export const combatLayoutE2ePort = () => resolvePort('COMBAT_LAYOUT_PORT', 4183, 15183, 'combat-layout');
export const liveE2ePort = () => resolvePort('LIVE_E2E_PORT', 4183, 16183, 'live express');

export const previewRootFor = (port: string) => `.playwright-dist-${port.replace(/[^a-z0-9_-]/gi, '_')}`;

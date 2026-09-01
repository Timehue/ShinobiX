import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('Activity Spine capability wiring contract', () => {
    it('passes the canonical server projection into the pure builder', () => {
        const endpoint = read('api/player/activity-spine.ts');
        assert.match(endpoint, /import \{ publicCapabilities \} from '\.\/_public-capabilities\.js'/);
        assert.match(endpoint, /capabilities:\s*publicCapabilities\(\)/);
        assert.doesNotMatch(endpoint, /process\.env|import\.meta\.env/);
    });

    it('keeps the availability helper downstream of the executable registry without a cycle', () => {
        const helper = read('shared/runtime-mode-capabilities.ts');
        const registry = read('shared/runtime-mode-registry.ts');
        assert.match(helper, /RUNTIME_MODE_REGISTRY/);
        assert.match(helper, /runtimeModeById/);
        assert.doesNotMatch(registry, /runtime-mode-capabilities/);
    });

    it('tags exact gated recommendations and separates generic Clan and Companion activity', () => {
        const builder = read('api/player/_activity-spine.ts');
        assert.match(builder, /runtimeModeId: 'clan-boss'/);
        assert.match(builder, /capabilityId: 'clanBossParties'/);
        assert.match(builder, /capabilityId: 'legacy'/);
        assert.match(builder, /runtimeModeId: 'pet-showdown-practice'/);
        assert.match(builder, /runtimeModeId: 'pet-ladder-showdown'/);
        assert.match(builder, /id: 'focus-clan-generic-week'/);
        assert.match(builder, /recoveryOnly: !!blocker/);
        assert.match(builder, /id: 'focus-service-review-week'/);
        assert.match(builder, /requiresMutation: false/);
    });

    it('re-resolves every Activity Spine action against live truth and makes blocked controls inert', () => {
        const component = read('shinobij.client/src/components/ActivitySpine.tsx');
        assert.match(component, /useLiveCapabilities\(\)/);
        assert.match(component, /projectedAdmissionAllowed\(activity\.requiredCapabilityIds\)/);
        assert.match(component, /availability\(id\) === "available"/);
        assert.doesNotMatch(component, /runtime-mode-capabilities/);
        assert.match(component, /const capabilityStateSignature = \[/);
        assert.match(component, /snapshot\.freshness/);
        assert.doesNotMatch(component, /snapshot\.lastUpdatedAt/);
        assert.match(component, /const blocked = activity\.eligibility === "blocked" \|\| !liveAdmissionAllowed/);
        assert.match(component, /const focus = "auto"/);
        assert.doesNotMatch(component, /focusAdmissionAllowed|Mastery focus|activity-focus-select/);
        assert.match(component, /disabled=\{blocked\}/);
        assert.match(component, /onClick=\{blocked \? undefined :/);
    });

    it('renders one validated point-in-time public projection and runtime matrix in Admin Diagnostics', () => {
        const diagnostics = read('shinobij.client/src/screens/AdminDiagnosticsPanel.tsx');
        assert.match(diagnostics, /fetch\("\/api\/admin\/runtime-mode-capabilities"/);
        assert.match(diagnostics, /cache:\s*"no-store"/);
        assert.match(diagnostics, /parseRuntimeCapabilityProjection\(data\)/);
        assert.match(diagnostics, /section === "capabilities"[\s\S]*loadCapabilities\(\)/);
        assert.match(diagnostics, /PUBLIC_CAPABILITY_IDS\.map/);
        assert.match(diagnostics, /capability\.state/);
        assert.match(diagnostics, /capability\.reason/);
        assert.match(diagnostics, /setRuntimeCapabilityRows\(projection\.runtimeModes/);
        assert.doesNotMatch(diagnostics, /from\s+["'][^"']*shared\/runtime-mode-capabilities/);
        assert.match(diagnostics, /onClick=\{\(\) => void loadCapabilities\(\)\}/);
        assert.doesNotMatch(diagnostics, /import\.meta\.env|process\.env/);
        assert.doesNotMatch(diagnostics, /clanBoss.*&&.*clanBossParties|clanBossParties.*&&.*clanBoss/is);
    });

    it('projects exact required ids on every returned activity and derives the admin matrix on the server', () => {
        const builder = read('api/player/_activity-spine.ts');
        const endpoint = read('api/admin/runtime-mode-capabilities.ts');
        assert.match(builder, /requiredCapabilityIds\s*=\s*availability\.capabilityIds/);
        assert.match(endpoint, /capabilities,\s*\n\s*runtimeModes:/);
        assert.match(endpoint, /runtimeModeCapabilityMatrix\(capabilities\)/);
        assert.match(endpoint, /isAdmin\(req\)/);
        assert.match(endpoint, /Cache-Control', 'no-store'/);
    });
});

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

describe("capability refresh UI contracts", () => {
    it("does not present an earlier diagnostics response during or after a failed exact read", () => {
        const source = read("./screens/AdminDiagnosticsPanel.tsx");
        const start = source.indexOf("const loadCapabilities = useCallback(async () => {");
        const end = source.indexOf("useEffect(() => { if (section === \"capabilities\")", start);
        assert.notEqual(start, -1);
        assert.notEqual(end, -1);

        const loader = source.slice(start, end);
        const firstClear = loader.indexOf("setCapabilityResponse(null);");
        const request = loader.indexOf('fetch("/api/admin/runtime-mode-capabilities"');
        const catchBlock = loader.indexOf("} catch (error) {");
        const errorClear = loader.indexOf("setCapabilityResponse(null);", catchBlock);
        const matrixClear = loader.indexOf("setRuntimeCapabilityRows([]);", catchBlock);

        assert.ok(firstClear > -1 && firstClear < request, "the previous response must be cleared before refresh starts");
        assert.ok(errorClear > catchBlock, "a failed refresh must leave no response labelled as exact and current");
        assert.ok(matrixClear > catchBlock, "a failed refresh must also clear the server-projected runtime matrix");
    });

    it("refetches the Activity Spine only when effective capability state or freshness changes", () => {
        const source = read("./components/ActivitySpine.tsx");

        assert.match(source, /PUBLIC_CAPABILITY_IDS/);
        assert.match(source, /const capabilityStateSignature = \[/);
        assert.match(source, /snapshot\.freshness/);
        assert.match(source, /PUBLIC_CAPABILITY_IDS\.map\(\(id\) => `\$\{id\}:\$\{availability\(id\)\}`\)/);
        assert.match(source, /\}, \[character\.name, focus, retry, capabilityStateSignature\]\);/);
        assert.doesNotMatch(source, /\}, \[character\.name, focus, retry, snapshot\.(?:capabilities|freshness|lastUpdatedAt)/);
    });
});

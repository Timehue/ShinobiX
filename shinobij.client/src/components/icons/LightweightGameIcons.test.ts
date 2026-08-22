import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const clientRoot = join(process.cwd(), "shinobij.client");

function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(absolute);
        return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")
            ? [absolute]
            : [];
    });
}

test("the heavyweight icon package stays out of the player bundle", () => {
    const packageJson = JSON.parse(readFileSync(join(clientRoot, "package.json"), "utf8"));
    assert.equal(packageJson.dependencies?.["react-icons"], undefined);

    const offenders = sourceFiles(join(clientRoot, "src"))
        .filter((file) => /from ["']react-icons(?:\/[^"']+)?["']/.test(readFileSync(file, "utf8")))
        .map((file) => relative(clientRoot, file).replaceAll("\\", "/"));

    assert.deepEqual(offenders, []);
});

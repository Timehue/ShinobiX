import { posix } from 'node:path';

import type { Plugin } from 'vite';

type StaticChunk = {
    fileName: string;
    imports: string[];
    modules: Record<string, unknown>;
};

const PET_ARENA_MODULE = '/src/screens/PetArena.tsx';
const FORBIDDEN_SETUP_MODULES = [
    '/src/components/PetWarfrontMatch.tsx',
    '/src/lib/pet-warfront-sim.ts',
    '/src/lib/pet-warfront-map.ts',
    '/src/lib/pet-warfront-mask-baked.ts',
] as const;

function normalizedModuleId(id: string) {
    return id.replaceAll('\\', '/').split('?', 1)[0];
}

function normalizedChunkFileName(fileName: string) {
    return posix.normalize(fileName.replaceAll('\\', '/').replace(/^\.?\/+/, ''));
}

function importedChunkFileNames(importer: string, imported: string) {
    const normalizedImport = imported.replaceAll('\\', '/');
    const direct = normalizedChunkFileName(normalizedImport);
    const relative = normalizedChunkFileName(posix.join(posix.dirname(importer), normalizedImport));
    return normalizedImport.startsWith('.')
        ? [relative]
        : direct === relative ? [direct] : [direct, relative];
}

export type PetArenaStaticGraphAudit = {
    entryChunks: string[];
    reachableChunks: string[];
    forbiddenModules: Array<{ chunk: string; module: string }>;
};

/**
 * Traverse the emitted chunk graph from the Pet Arena screen using `imports`
 * only. `dynamicImports` are intentionally outside the setup graph: loading
 * PetWarfrontMatch after the player commits is the desired split boundary.
 */
export function auditPetArenaStaticGraph(chunks: StaticChunk[]): PetArenaStaticGraphAudit {
    const byFileName = new Map(chunks.map((chunk) => [normalizedChunkFileName(chunk.fileName), chunk]));
    const entryChunks = chunks
        .filter((chunk) => Object.keys(chunk.modules).some((id) => normalizedModuleId(id).endsWith(PET_ARENA_MODULE)))
        .map((chunk) => normalizedChunkFileName(chunk.fileName));
    const reachable = new Set<string>();
    const pending = [...entryChunks];

    while (pending.length) {
        const fileName = pending.pop()!;
        if (reachable.has(fileName)) continue;
        reachable.add(fileName);
        const chunk = byFileName.get(fileName);
        if (!chunk) continue;
        for (const imported of chunk.imports) {
            const importedFileName = importedChunkFileNames(fileName, imported)
                .find((candidate) => byFileName.has(candidate));
            if (!importedFileName) continue;
            if (byFileName.has(importedFileName) && !reachable.has(importedFileName)) {
                pending.push(importedFileName);
            }
        }
    }

    const forbiddenModules = [...reachable].flatMap((fileName) => {
        const chunk = byFileName.get(fileName);
        if (!chunk) return [];
        return Object.keys(chunk.modules)
            .map(normalizedModuleId)
            .filter((id) => FORBIDDEN_SETUP_MODULES.some((suffix) => id.endsWith(suffix)))
            .map((module) => ({ chunk: fileName, module }));
    });

    return {
        entryChunks,
        reachableChunks: [...reachable].sort(),
        forbiddenModules,
    };
}

export function assertPetArenaStaticIsolation(chunks: StaticChunk[]) {
    const audit = auditPetArenaStaticGraph(chunks);
    if (audit.entryChunks.length !== 1) {
        throw new Error(
            `[pet-arena-static-isolation] Expected exactly one emitted chunk containing PetArena.tsx; found ${audit.entryChunks.length}.`,
        );
    }
    if (audit.forbiddenModules.length) {
        const details = audit.forbiddenModules
            .map(({ chunk, module }) => `  - ${module} via ${chunk}`)
            .join('\n');
        throw new Error(
            `[pet-arena-static-isolation] Pet Arena setup statically reaches the full Warfront runtime:\n${details}`,
        );
    }
}

export function petArenaStaticIsolationPlugin(): Plugin {
    return {
        name: 'pet-arena-static-isolation',
        apply: 'build',
        generateBundle(_options, bundle) {
            const chunks: StaticChunk[] = Object.values(bundle)
                .filter((entry) => entry.type === 'chunk')
                .map((chunk) => ({
                    fileName: chunk.fileName,
                    imports: chunk.imports,
                    modules: chunk.modules,
                }));
            assertPetArenaStaticIsolation(chunks);
        },
    };
}

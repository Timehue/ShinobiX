import ts from 'typescript';
import { packedWorldData } from './packed-world-data.mjs';

/** Replace one literal initializer; preserve the module's functions and exports. */
export function packStaticCatalog(source, name, value) {
    const file = ts.createSourceFile('catalog.ts', source, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
            const expression = packedWorldData(JSON.stringify(value)).slice('export default '.length, -1);
            return source.slice(0, declaration.initializer.getStart(file)) + expression + source.slice(declaration.initializer.end);
        }
    }
    throw new Error(`Missing static catalog initializer: ${name}`);
}

import ts from 'typescript';
import { packedDataExpression, PACKED_DATA_IMPORT } from './packed-world-data.mjs';

function withDecoder(source) {
    return source.includes(PACKED_DATA_IMPORT) ? source : `${PACKED_DATA_IMPORT}\n${source}`;
}

function catalogDeclaration(source, name) {
    const file = ts.createSourceFile('catalog.ts', source, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return { file, declaration };
        }
    }
    throw new Error(`Missing static catalog initializer: ${name}`);
}

function catalogPayload(initializer) {
    return ts.isCallExpression(initializer) && initializer.arguments.length === 1
        && ts.isPropertyAccessExpression(initializer.expression)
        && ts.isIdentifier(initializer.expression.expression) && initializer.expression.expression.text === 'Object'
        && initializer.expression.name.text === 'freeze' ? initializer.arguments[0] : initializer;
}

/** Read JSON-compatible literals without executing the source module. */
export function staticCatalogValue(source, name) {
    const { file, declaration } = catalogDeclaration(source, name);
    const scalars = new Map();
    // Only earlier const primitives can be substituted. Object references,
    // mutable bindings, getters and executable initializers stay unsupported.
    for (const statement of file.statements) {
        if (statement.getStart(file) >= declaration.getStart(file)) break;
        if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
        for (const binding of statement.declarationList.declarations) {
            if (binding.getStart(file) >= declaration.getStart(file)) break;
            if (!ts.isIdentifier(binding.name) || !binding.initializer) continue;
            try {
                const primitive = value(binding.initializer);
                if (primitive === null || ['string', 'number', 'boolean'].includes(typeof primitive)) scalars.set(binding.name.text, primitive);
            } catch { /* Non-literal bindings are not evaluated. */ }
        }
    }
    function value(node) {
        if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)) return value(node.expression);
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        if (ts.isNumericLiteral(node)) return Number(node.text);
        if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
        if (node.kind === ts.SyntaxKind.NullKeyword) return null;
        if (ts.isIdentifier(node) && scalars.has(node.text)) return scalars.get(node.text);
        if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken].includes(node.operator)) return (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1) * Number(node.operand.text);
        if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
        if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
            if (!ts.isPropertyAssignment(property) || ![ts.isIdentifier, ts.isStringLiteral, ts.isNumericLiteral].some(check => check(property.name))) throw new Error(`Non-literal property in static catalog: ${name}`);
            return [property.name.text, value(property.initializer)];
        }));
        throw new Error(`Non-literal expression in static catalog: ${name}`);
    }
    return value(catalogPayload(declaration.initializer));
}

export function packStaticCatalogLiteral(source, name) {
    const { file, declaration } = catalogDeclaration(source, name);
    const payload = catalogPayload(declaration.initializer);
    const expression = packedDataExpression(JSON.stringify(staticCatalogValue(source, name)));
    // Keep the original Object.freeze wrapper, type and surrounding code.
    return withDecoder(source.slice(0, payload.getStart(file)) + expression + source.slice(payload.end));
}

/** Replace one literal initializer; preserve the module's functions and exports. */
export function packStaticCatalog(source, name, value) {
    const { file, declaration } = catalogDeclaration(source, name);
    const expression = packedDataExpression(JSON.stringify(value));
    return withDecoder(source.slice(0, declaration.initializer.getStart(file)) + expression + source.slice(declaration.initializer.end));
}

import ts from 'typescript';

/** Read test-source JSX boundaries without confusing arrows with closing tags. */
export function jsxElementsByTag(source: string, tag: string) {
    const file = ts.createSourceFile('layout.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const elements: { body: string; className?: string }[] = [];
    function visit(node: ts.Node) {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === tag) {
            const className = node.openingElement.attributes.properties.find(
                property => ts.isJsxAttribute(property) && property.name.getText(file) === 'className',
            );
            elements.push({
                body: source.slice(node.openingElement.end, node.closingElement.getStart(file)),
                className: className && ts.isJsxAttribute(className) && className.initializer && ts.isStringLiteral(className.initializer)
                    ? className.initializer.text : undefined,
            });
        }
        ts.forEachChild(node, visit);
    }
    visit(file);
    return elements;
}

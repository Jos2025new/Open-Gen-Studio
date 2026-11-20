import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSync } from 'rolldown/utils';

const comparesTool = (name: string) => name === 'tool';
const hasTool = (node: any): boolean =>
  (node?.type === 'Identifier' && comparesTool(node.name)) ||
  (node?.type === 'MemberExpression' && (comparesTool(node.property.name) || comparesTool(node.property.value)));
const isLiteralTool = (node: any): boolean => node?.type === 'Literal' && typeof node.value === 'string';

it.each(['Stage', 'QuickSettings', 'ToolSettings', 'ContextStrip'])('%s dispatches through tool descriptors', (name) => {
  const file = `src/components/designer/${name}.tsx`;
  const source = readFileSync(file, 'utf8');
  const { program, errors } = parseSync(file, source);
  expect(errors).toEqual([]);
  const violations: string[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(node.operator) &&
      ((hasTool(node.left) && isLiteralTool(node.right)) || (hasTool(node.right) && isLiteralTool(node.left)))) {
      const line = source.slice(0, node.start).split('\n').length;
      violations.push(`${file}:${line}: select the behavior from the tool descriptor.`);
    }
    Object.values(node).forEach(visit);
  };
  visit(program);
  expect(violations).toEqual([]);
});

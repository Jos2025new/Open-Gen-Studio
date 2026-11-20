import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript/unstable/ast';
import { API, type Symbol as TypeSymbol, type Project } from 'typescript/unstable/sync';
import { describe, expect, it } from 'vitest';
import { ownDeps, stepDeps, stepOutputKind } from '../src/engine/plan';
import { GRAPH_STEP } from '../src/engine/planSteps/graph';
import { STEP_INFO } from '../src/engine/planSteps/inspect';
import { RAW_STEP_INFO } from '../src/engine/planSteps/raw';
import type { PlanStep } from '../src/engine/types';
import { NORMALIZE_STEP } from '../src/engine/planSteps';
import { ESTIMATE_STEP, RUN_STEP } from '../src/engine/planSteps/exec';

/** Opus #5: step-kind behavior lives in planSteps. */
function planStepKinds(): string[] {
  const types = readFileSync('src/engine/types.ts', 'utf8');
  const union = /export type PlanStep = ([^;]+);/.exec(types)![1].split('|').map((n) => n.trim());
  return union.map((name) => new RegExp(`export interface ${name} extends StepBase \\{\\s*kind: '([a-z0-9]+)'`).exec(types)?.[1] ?? `?${name}`);
}

function kindBranches(kinds: string[]): string[] {
  const config = join(process.cwd(), 'tsconfig.json');
  const api = new API({ cwd: process.cwd() });
  try {
    const project = api.updateSnapshot({ openProjects: [config] }).getProject(config);
    if (!project) throw new Error(`Unable to load ${config}`);
    return branchesInProject(project, kinds);
  } finally {
    api.close();
  }
}

function branchesInProject({ program, checker }: Project, kinds: string[]): string[] {
  const problems: string[] = [];
  const comparisons = new Set<ts.SyntaxKind>([
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ]);
  const root = `${process.cwd()}/`;
  const engineRoot = `${root}src/engine/`;
  function isStepKindProperty(symbol: TypeSymbol | undefined, source: string): boolean {
    return symbol?.declarations.some((handle) => {
      const decl = handle.resolve();
      if (!decl || !ts.isInterfaceDeclaration(decl.parent)) return false;
      if (!decl.getSourceFile().fileName.startsWith(engineRoot)) return false;
      return Boolean(decl.parent.heritageClauses?.some((clause) =>
        clause.types.some((type) => type.expression.getText() === 'StepBase')))
        || (decl.parent.name.text === 'RawStep' && source.endsWith('/engine/plan.ts'));
    }) ?? false;
  }
  function isStepKind(expression: ts.Expression): boolean {
    const source = expression.getSourceFile().fileName;
    if (ts.isParenthesizedExpression(expression)) return isStepKind(expression.expression);
    if (ts.isIdentifier(expression)) {
      const declaration = checker.getSymbolAtLocation(expression)?.declarations[0]?.resolve();
      if (declaration && ts.isBindingElement(declaration) && (declaration.propertyName ?? declaration.name)?.getText() === 'kind') {
        const step = checker.getTypeAtLocation(declaration.parent);
        return isStepKindProperty(step && checker.getPropertyOfType(step, 'kind'), source);
      }
      if (!declaration || !ts.isVariableOrParameterDeclaration(declaration)) return false;
      const type = declaration.type;
      if (type && ts.isIndexedAccessTypeNode(type) && (type.objectType.getText() === 'PlanStep' || (type.objectType.getText() === 'RawStep' && source.endsWith('/engine/plan.ts')))
        && ts.isLiteralTypeNode(type.indexType) && ts.isStringLiteral(type.indexType.literal) && type.indexType.literal.text === 'kind') return true;
      const initializer = declaration.initializer;
      return Boolean(initializer && (ts.isPropertyAccessExpression(initializer) || ts.isElementAccessExpression(initializer)) && isStepKind(initializer));
    }
    if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'kind') {
      return isStepKindProperty(checker.getSymbolAtLocation(expression.name), source);
    }
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) && expression.argumentExpression.text === 'kind') {
      const step = checker.getTypeAtLocation(expression.expression);
      const nonNullable = step && checker.getNonNullableType(step);
      return isStepKindProperty(nonNullable && checker.getPropertyOfType(nonNullable, 'kind'), source);
    }
    return false;
  }
  const isKindLiteral = (expression: ts.Expression) => (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) && kinds.includes(expression.text);
  for (const fileName of program.getSourceFileNames()) {
    if (!fileName.startsWith(root)) continue;
    const path = fileName.slice(root.length);
    if (!path.startsWith('src/engine/') || path.startsWith('src/engine/planSteps/')) continue;
    const file = program.getSourceFile(fileName);
    if (!file) throw new Error(`Unable to read ${path}`);
    const visit = (node: ts.Node): void => {
      const comparison = ts.isBinaryExpression(node) && comparisons.has(node.operatorToken.kind);
      if ((ts.isSwitchStatement(node) && isStepKind(node.expression))
        || (comparison && ((isKindLiteral(node.left) && isStepKind(node.right)) || (isKindLiteral(node.right) && isStepKind(node.left))))) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        problems.push(`${path}:${line + 1} — use an entry in planSteps for this kind`);
      }
      node.forEachChild(visit);
    };
    visit(file);
  }
  return problems.sort();
}

describe('step kinds have one entry in every table', () => {
  const kinds = planStepKinds().sort();
  it('reads the kinds from the PlanStep union', () => {
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((kind) => !kind.startsWith('?'))).toBe(true);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
  it.each([['normalize', NORMALIZE_STEP], ['estimate', ESTIMATE_STEP], ['run', RUN_STEP]] as const)('%s has an entry per kind and no other', (_name, table) => {
    expect(Object.keys(table).sort()).toEqual(kinds);
    for (const kind of kinds) expect(typeof (table as Record<string, unknown>)[kind]).toBe('function');
  });
  it.each([['inspect', STEP_INFO], ['graph', GRAPH_STEP], ['raw', RAW_STEP_INFO]] as const)('%s describes every kind', (_name, table) => {
    expect(Object.keys(table).sort()).toEqual(kinds);
  });
  it('keeps step-kind branches in planSteps', () => {
    expect(kindBranches(kinds)).toEqual([]);
  }, 20_000);
});

describe('step metadata preserves references and output kinds', () => {
  it('keeps ordered clip, role and music references ahead of scheduling dependencies', () => {
    const step: PlanStep = {
      id: 'join', title: 'Join', kind: 'op', op: 'join_clips', input: 'clip1#2', more: ['clip2'],
      refs: [{ ref: 'asset:poster' }], params: { music: 'soundtrack' }, after: ['subject'],
    };
    expect(stepOutputKind(step)).toBe('video');
    expect(ownDeps(step)).toEqual(['clip1#2', 'clip2', 'asset:poster', 'soundtrack']);
    expect(stepDeps(step)).toEqual(['clip1#2', 'clip2', 'asset:poster', 'soundtrack', 'subject']);
  });

  it('keeps layer ordering dependencies exactly once and supports lyrics as text', () => {
    const layer: PlanStep = { id: 'layer', title: 'Layer', kind: 'layer', layerType: 'raster', target: 'new', source: 'picture', after: ['other'] };
    expect(ownDeps(layer)).toEqual(['picture', 'other']);
    expect(stepDeps(layer)).toEqual(['picture', 'other']);
    const audio: PlanStep = {
      id: 'lyrics', title: 'Lyrics', kind: 'audio', prompt: 'A song', modelRef: 'lyrics',
      settings: { count: 1, advanced: {} }, promptFrom: 'draft', textOutput: true,
    };
    expect(stepOutputKind(audio)).toBe('text');
    expect(stepDeps(audio)).toEqual(['draft']);
  });
});

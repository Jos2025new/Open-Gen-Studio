/** The raw provider modules are private dependencies of the paid transport. */
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scan } from './ast-scan.mjs';

const transport = 'src/engine/money/transport.ts';
const providers = 'src/engine/providers/';
const raw = new Map([
  [providers + 'atlas', { exports: ['atlas'], hint: '.generate() and other adapter methods require paidSend.' }],
  [providers + 'demo', { exports: ['local'], hint: '.generate() and other adapter methods require paidSend.' }],
  [providers + 'fal', { exports: ['fal'], hint: '.generate() and other adapter methods require paidSend.' }],
  [providers + 'nanogpt', { exports: ['nanogpt'], hint: '.generate() and other adapter methods require paidSend.' }],
  [providers + 'openrouter', { exports: ['openrouter'], hint: '.generate() and other adapter methods require paidSend.' }],
  [providers + 'nanogptAudio', { exports: ['generateSpeech', 'transcribe'], internal: [providers + 'nanogpt.ts'], hint: 'Use the media transport through paidSend.' }],
  [providers + 'llm', { exports: ['chat'], hint: 'Use sendLlmViaPaidGate to send through paidSend.' }],
  ['src/lib/http', {
    exports: ['requestJson', 'fetchJsonWithRelay'],
    internal: ['atlas', 'fal', 'llm', 'nanogpt', 'nanogptAudio', 'openrouter'].map(name => providers + name + '.ts'),
    hint: 'Use the provider transport through paidSend.',
  }],
  ['src/lib/providerFetch', {
    exports: ['providerFetch'],
    internal: ['src/lib/http.ts', 'src/lib/media.ts', providers + 'llm.ts', providers + 'nanogptAudio.ts'],
    hint: 'Use the provider transport through paidSend.',
  }],
]);

function resolveTarget(from, source) {
  if (typeof source !== 'string' || !source.startsWith('.')) return '';
  return posix.join(posix.dirname(from), source).replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '');
}

export function check(root = '.') {
  return scan(root, {
    allowed: new Set(),
    what: 'paidSend imports',
    rules: ({ rel }) => {
      const ancestors = [];
      return {
      enter(node, report) {
        const parent = ancestors.at(-1);
        ancestors.push(node);
        const declaration = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type);
        const runtimeLoad = node.type === 'ImportExpression';
        if (node.type === 'Identifier' && node.name === 'require' &&
          !((parent?.key === node || parent?.property === node) && !parent.computed && !parent.shorthand)) {
          report(node, 'Use static imports so paidSend can check the module boundary.');
          return;
        }
        if ((!declaration && !runtimeLoad) || node.importKind === 'type' || node.exportKind === 'type') return;
        const source = node.source;
        if (runtimeLoad && source?.type !== 'Literal') {
          report(node, 'Use a string literal with import() so paidSend can check the module boundary.');
          return;
        }
        const rule = raw.get(resolveTarget(rel, source?.value));
        if (!rule) return;
        const names = node.specifiers?.filter(spec => spec.importKind !== 'type' && spec.exportKind !== 'type')
          .map(spec => (spec.imported ?? (spec.type === 'ExportSpecifier' ? spec.local : undefined))?.name);
        if (names?.every(name => name && !rule.exports.includes(name))) return;
        if (node.type === 'ImportDeclaration' && (rel === transport || rule.internal?.includes(rel))) return;
        report(node, `Raw provider import outside the paidSend transport. ${rule.hint}`);
      },
      leave() { ancestors.pop(); },
      };
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = check('.');
  if (errors.length) {
    console.error(`check-paid-send: ${errors.length} disallowed raw provider imports\n${errors.map(e => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log('check-paid-send: raw provider imports stay inside the paidSend transport.');
}

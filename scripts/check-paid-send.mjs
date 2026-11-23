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
    rules: ({ rel }) => ({
      enter(node, report) {
        const declaration = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type);
        const required = node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require';
        if (!declaration && !required && node.type !== 'ImportExpression') return;
        if (node.importKind === 'type' || node.exportKind === 'type') return;
        const source = required ? node.arguments[0] : node.source;
        const rule = raw.get(resolveTarget(rel, source?.value));
        if (!rule) return;
        const names = node.specifiers?.filter(spec => spec.importKind !== 'type' && spec.exportKind !== 'type')
          .map(spec => (spec.imported ?? (spec.type === 'ExportSpecifier' ? spec.local : undefined))?.name);
        if (names?.every(name => name && !rule.exports.includes(name))) return;
        if (node.type === 'ImportDeclaration' && (rel === transport || rule.internal?.includes(rel))) return;
        report(node, `Raw provider import outside the paidSend transport. ${rule.hint}`);
      },
    }),
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

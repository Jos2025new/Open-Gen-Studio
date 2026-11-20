/** Opus #14: an export of src/engine that no other file in src/, tests/ or scripts/ names is dead code (or a re-export nobody imports).
 *  Existing ones are listed in dead-exports-baseline.json: that list may shrink, never grow. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPE = /^src\/engine\/.*\.(ts|tsx)$/;
const READERS = /^(src|tests|scripts)\/.*\.(ts|tsx|mjs)$/;
const lineOf = (text, at) => text.slice(0, at).split('\n').length;

/** `{ path, text }[]` of every project file -> `file:line: name` problems for engine exports no other file names. */
export function deadExports(files, baseline = {}) {
  const errors = [];
  const names = (file) => {
    const found = [];
    const { text } = file;
    for (const m of text.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) found.push([m[1], m.index]);
    for (const m of text.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {
      for (const part of m[1].split(',')) {
        const spec = part.trim();
        if (!spec || spec.startsWith('type ')) continue;
        found.push([spec.split(/\s+as\s+/).pop().trim(), m.index]);
      }
    }
    return found;
  };
  // A re-export (`export { x }` of an imported name) is only alive when some file imports it from this very module; the name alone also
  // appears where x is defined, so it cannot tell. A pure alias (`export const a = b;`) is a second name for one thing.
  const reexports = (file) => {
    const out = [];
    for (const m of file.text.matchAll(/^export\s*\{([^}]*)\}(?!\s*from)/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (name && !part.trim().startsWith('type ') && new RegExp(`^import\\s[^;]*\\b${name}\\b[^;]*from`, 'm').test(file.text)) out.push([name, m.index]);
      }
    }
    return out;
  };
  const aliases = (file) => [...file.text.matchAll(/^export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$.]*;\s*$/gm)].map((m) => [m[1], m.index]);
  const readers = files.filter((f) => READERS.test(f.path));
  for (const file of files.filter((f) => SCOPE.test(f.path))) {
    const reexported = new Map(reexports(file));
    const aliased = new Map(aliases(file));
    const base = file.path.replace(/\.tsx?$/, '').split('/').pop();
    for (const [name, at] of names(file)) {
      if (baseline[file.path]?.includes(name)) continue;
      const word = new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`);
      if (reexported.has(name)) {
        const from = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])[^}]*\\}\\s*from\\s*['"][^'"]*/${base}(?:\\.\\w+)?['"]`);
        if (readers.some((r) => r.path !== file.path && from.test(r.text))) continue;
        errors.push(`${file.path}:${lineOf(file.text, at)}: re-export \`${name}\` is imported from this file by nobody. Delete the re-export; callers import it from its own module.`);
        continue;
      }
      if (readers.some((r) => r.path !== file.path && word.test(r.text)) && !aliased.has(name)) continue;
      if (aliased.has(name)) {
        errors.push(`${file.path}:${lineOf(file.text, aliased.get(name))}: \`${name}\` is only another name for an existing export. Use the original name at its callers and delete the alias.`);
        continue;
      }
      errors.push(`${file.path}:${lineOf(file.text, at)}: \`${name}\` is exported but no other file in src/, tests/ or scripts/ uses it. Delete it (or drop \`export\` if the file itself needs it); an alias or re-export nobody imports is dead weight.`);
    }
  }
  return errors;
}

export function checkDeadExports(root) {
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  const files = [...new Set(listed.split('\0').filter((p) => READERS.test(p)))].map((path) => {
    try { return { path, text: readFileSync(join(root, path), 'utf8') }; } catch { return null; }
  }).filter(Boolean);
  let baseline = {};
  try { baseline = JSON.parse(readFileSync(join(root, 'scripts/dead-exports-baseline.json'), 'utf8')); } catch { /* none yet */ }
  const errors = deadExports(files, baseline);
  if (errors.length) throw new Error(`check-dead-exports: FAIL\n${errors.join('\n')}`);
  console.log('check-dead-exports: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkDeadExports(process.cwd()); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

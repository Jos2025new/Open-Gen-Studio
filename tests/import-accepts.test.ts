// @ts-nocheck -- reads two component sources; the project has no @types/node (same as debug-info.test.ts).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ACCEPT = /accept="([^"]*)" multiple hidden/;
const accepts = (file: string) => ACCEPT.exec(readFileSync(file, 'utf8'))?.[1] ?? '';

describe('import accept lists', () => {
  it('the Designer and the node area take the same EPS and HEIC types', () => {
    const designer = accepts('src/components/designer/DesignerWorkspace.tsx');
    const nodes = accepts('src/components/node/NodeWorkspace.tsx');
    for (const type of ['.eps', 'application/postscript', '.heic', '.heif', 'image/heic']) {
      expect(designer).toContain(type);
      expect(nodes).toContain(type);
    }
  });
});

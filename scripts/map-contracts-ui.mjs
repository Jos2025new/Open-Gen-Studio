/** Registered by map-contracts.mjs: shortcuts, and the appearance preference (pre-paint script, theme module and Settings share keys and mapping). */
export default [
  {
    id: 'shortcuts',
    what: 'Los atajos de teclado: el manejador, Ajustes → Shortcuts y el README leen la misma lista.',
    sides: [
      ['src/engine/shortcuts.ts', "{ keys: 'Mod + S'"],
      ['src/components/designer/designerKeys.ts', 'void saveNow().catch'],
      ['src/components/shell/SettingsPanel.tsx', 'Save (Mod+S) also works while typing'],
      ['src/engine/shortcuts.ts', 'export function shortcutGroups'],
      ['src/components/designer/designerKeys.ts', 'DESIGN_TOOL_KEYS[e.key.toLowerCase()]'],
      ['src/components/designer/PathNodes.tsx', 'marqueeNodeSelection'],
      ['src/components/shell/SettingsPanel.tsx', 'shortcutGroups()'],
      ['README.md', '<!-- shortcuts:start -->'],
    ],
    tests: ['tests/readme-shortcuts.test.ts'],
  },
  {
    id: 'appearance',
    what: 'La apariencia (base y resaltado) es solo preferencia de interfaz en localStorage (ogs-base, ogs-accent): el script de index.html antes del primer pintado, src/lib/theme.ts y Ajustes → Look comparten claves y mapeo; nunca va al almacén ni a los ajustes persistidos.',
    sides: [
      ['index.html', "localStorage.getItem('ogs-base')"],
      ['src/lib/theme.ts', "export const BASE_KEY = 'ogs-base'"],
      ['src/components/shell/AppearanceSection.tsx', 'export function AppearanceSection'],
      ['src/components/shell/SettingsPanel.tsx', '<AppearanceSection />'],
      ['src/styles/accents.css', '[data-accent="aurora"]'],
    ],
    tests: ['tests/theme-appearance.test.ts', 'tests/theme-prepaint.test.ts', 'tests/theme-tokens.test.ts'],
  },
];

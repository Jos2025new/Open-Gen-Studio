/** Connected-node UI and atomic graph creation share the output port and compatible input contract. */
export default [{
  id: 'connected-node-picker',
  what: 'El + es el puerto real; soltar en vacío abre destinos compatibles y conserva la curva hasta elegir o cancelar. Crear nodo y enlace es un solo deshacer.',
  sides: [
    ['src/components/node/ConnectedNodeMenu.tsx', 'id="out" type="source"'],
    ['src/components/node/ConnectedNodeMenu.tsx', 'export function ConnectionPreview'],
    ['src/components/node/connectionDrop.ts', 'export function connectionDrop'],
    ['src/components/node/AddNodeItems.tsx', 'portFits(accepts'],
    ['src/components/node/NodeWorkspace.tsx', 'connectionDrop(e, state, canvasRef.current)'],
    ['src/engine/flow/addConnected.ts', 'connect(next, edge)'],
    ['src/styles/node.css', '.node-connection-preview path'],
  ],
  tests: ['tests/connected-node-menu.test.ts', 'tests/node-connection-drop.test.ts', 'tests/add-connected-node.test.ts'],
}];

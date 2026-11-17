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
}, {
  id: 'system-nodes-and-link-classes',
  what: 'Chat, agente, modelos, docs y Spaces son nodos `ref` que apuntan a sus datos (sin copiar). Los enlaces tienen clase (data, ref, control) y `both` solo en ref y control; el orden de ejecución sale de los enlaces data. Cambiar un lado cambia los demás.',
  sides: [
    ['src/engine/graphTypes.ts', 'export interface RefNodeData'],
    ['src/engine/nodes/spec.ts', 'export const SYSTEM_NODE_TYPES'],
    ['src/engine/nodes/system.ts', 'export function ensureSystemNodes'],
    ['src/engine/nodes/commands.ts', 'nodes.system.link'],
    ['src/engine/flow/graph.ts', 'export function executionOrder'],
    ['src/components/node/SystemNode.tsx', 'export function linkClassProps'],
    ['src/styles/node-system.css', '.edge-link-control'],
    ['src/engine/nodes/omniSpaces.ts', 'export const hiddenInOrdinary'],
    ['src/components/node/AddNodeItems.tsx', 'const SYSTEM_ENTRIES'],
  ],
  tests: ['tests/system-nodes.test.ts', 'tests/omnicanvas.test.ts', 'tests/adversarial-p7-add-node.test.ts'],
}];

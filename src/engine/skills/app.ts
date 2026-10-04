import canvas from './app/canvas.md?raw';
import nodes from './app/nodes.md?raw';
import designer from './app/designer.md?raw';

export const APP_GUIDES = [
  { id: 'canvas', name: 'Canvas / Chat', description: 'Herramientas de Chat, búsqueda de resultados, traslados y límites.', text: canvas },
  { id: 'nodes', name: 'Nodes', description: 'Lectura, edición y ejecución del grafo; ajustes y límites.', text: nodes },
  { id: 'designer', name: 'Designer', description: 'Vista del documento, planes de capas y límites de edición.', text: designer },
];

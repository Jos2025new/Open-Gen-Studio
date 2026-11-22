# Cómo se añade cada cosa

Regla de fondo: **una definición por cada lista cerrada y una sola vía por cada efecto**. Si para añadir algo tienes que copiar una lista o escribir el grafo o enviar dinero por otro camino, para: falta reutilizar lo existente. Historia y motivo: [073](history/073-2026-11-W47-master-posicion-vista-subnet.md) y la sesión maestra 6 (2026-11-22).

| Qué | Pasos | Lo vigila (`npm test`) |
|---|---|---|
| **Comando** | Un `defineCommand({ id, title, args: z.object().strict(), effect, run })` en `<área>/commands.ts` o `<nombre>.commands.ts`. Los enums de argumentos usan las tuplas (`BASE_SYSTEM_NODE_TYPES`, `BASE_NODE_KINDS`, `LINK_KINDS`, `MODEL_ATTACH_MODES` en `graphTypes.ts`; `MEDIA_KINDS` en `types.ts`), nunca una copia. | `check-commands`, `tests/listas-cerradas.test.ts`, `tsc` |
| **Tipo de nodo creativo** | `src/engine/nodecore/types/<kind>.node.ts` con `defineNode` (modelo: `text.node.ts`). Si es nuevo en la unión, añádelo a `BASE_NODE_KINDS` o declara `ExtraNodeKinds`. Para que aparezca en el menú y la biblioteca: una entrada en `NODE_UIS` (`src/components/node/nodeUi.ts`, el orden del array es el del menú) y su icono en `KIND_ICON`. | `check-node-descriptors`, `tests/descriptor-ui-registry.test.tsx`, `tsc` |
| **Tipo de nodo de sistema** | Añádelo a `BASE_SYSTEM_NODE_TYPES`. `tsc` señala cada `Record<SystemNodeType, …>` que falta (`SYSTEM_NODE_TYPES` en `nodes/spec.ts`: título, puertos). Si `nodes.system.add` debe aceptarlo, añádelo a su selección explícita en `nodes/commands.ts`. | `tsc`, `tests/listas-cerradas.test.ts` |
| **Puerto** | Creativo: `inputs()`/`output()` del descriptor; los 5 de enlace son `CREATIVE_LINK_PORTS` (`nodes/spec.ts`). Sistema: `ports` de su entrada en `SYSTEM_NODE_TYPES`. Un id es para siempre: los cables guardados lo usan. | `tests/puertos-creativos.test.ts`, `tests/adversarial-neon-puertos.test.ts` |
| **Cableado** | Toda conexión (lienzo, `nodes.edge.connect`, `nodes.system.link`) pasa por `resolveWiring` + `applyEdit`. Solo el lienzo infiere el cable a reemplazar (`inferReplaces`), nunca uno fijado. | `check-graph-writes`, `tests/adversarial-neon-cableado*.test.ts` |
| **Panel o componente** | Lee del nodo y escribe por `applyEdit` (ADR 0031). No hay registro de paneles: un componente existente se envuelve como nodo en su propia tira, con revisión. Hooks de React con sus reglas. | `check-graph-writes`, `check-gui`, `hooks-lint` (oxlint: `rules-of-hooks` bloquea; `npm run lint` muestra los avisos de dependencias) |
| **Envío de pago a un proveedor** | Antes del transporte, `commitPaidSend` (`sendMark.ts`): registra la intención y vuelve a comprobar aborto y autorización. Una respuesta cobrada se anota antes de guardar nada local. | `tests/adversarial-neon-envios-rojos.test.ts`, `tests/adversarial-sonnet-dinero*.test.ts` |
| **Llamada de pago a un modelo de lenguaje** | `guardLlmBudget` (`credit.ts`) o `overLimit` (`budget.ts`) antes de `chat()`. Las gratuitas ($0) nunca frenan. Pasado el tope del usuario, «Continue once» deja pasar esa acción y el contador muestra el exceso. | `tests/budget-agent-counter.test.ts` |

Tests de componentes React: `tests/*.test.tsx` también corre.

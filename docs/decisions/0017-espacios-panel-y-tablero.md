# 0017 — Espacios: Space Panel + Space Board, y Studio con tablero

## Estado

Aceptado

## Fecha

2026-10-15

## Contexto

La interfaz mezclaba el compositor, los paneles de Generations y los formularios de operaciones en lugares distintos según el espacio. El usuario pidió un layout por espacios: ajustes a la izquierda y resultados a la derecha, con Home y una barra lateral por secciones como entrada. Studio (el chat) es un espacio de trabajo, no un panel superpuesto: tiene estado de agente, plan y borradores que no deben perderse. La rama `task/gui-cohesion` aún no está fusionada.

## Decisión

- **Dos piezas compartidas.** Un *Space Panel* (ajustes, fijo a la izquierda; Generate abajo) y un *Space Board* (resultados: Done, Failed, Ongoing y, solo en Create y Tools, Actions suggested), con un marco común (`SpaceFrame`). Create Media y Tools son `ui.space = 'create' | 'tools'`; muestran el marco **sobre** el espacio de trabajo, que sigue montado, y cualquier cambio de espacio, sesión o foco del compositor lo cierra (`homeAutoClose`). Un guardia de teclas en captura (`homeGuard.ts`) impide que los atajos del espacio oculto actúen mientras tanto.
- **Sin lógica nueva de generación.** El panel usa el estado `composer` y la misma ruta que ya existía (`SendDirect`; para Tools, `useOpRun`, `OpFields` y `ViaPick` extraídos de `OpForm`). Costes, proveedores y datos persistidos no cambian; `ui.space` es estado de interfaz.
- **Studio no es un `ui.space`.** Es `ui.workspace = 'chat'` con una columna de tablero a la derecha (redimensionable, cerrable, preferencia `ogs:studio-board`: abierto, ancho y vista). El tablero tiene tres vistas: Generations (el tablero compartido en su variante Studio), Nodes y Designer, estas dos con el canvas incrustado (ver [0018](0018-canvas-efectivo-del-agente.md)).
- **Un solo montaje.** Los canvases incrustados no se montan junto a su espacio de trabajo completo: con Studio activo, `NodeWorkspace` y `DesignerWorkspace` no están montados. Sus atajos y el portapapeles actúan solo si el último clic o foco cayó dentro del tablero (`useBoardFocus`); nunca desde el compositor del chat.
- **Código compartido, no copiado.** Lo que los dos Designers hacen igual vive en un módulo común (`designerKeys.ts`, `designerClipboard.ts`, `designerFile.ts`, `DocumentChoices`, `ToolGroup`); un cambio de uno es del otro.
- **Fuera de alcance por decisión:** pincel raster, relleno, selección de píxeles, regla y cuentagotas en el tablero; modo apilado de Studio en ancho estrecho; la pestaña Projects de Home.

## Alternativas

- **Reutilizar los paneles existentes (cajones) y solo moverlos.** Descartada: cada uno traía su propio contenedor y botones de cerrar y expandir; el usuario quería un layout, no un reacomodo.
- **Studio como un `ui.space` más.** Descartada: el chat tiene estado propio y el agente debe seguir viendo la conversación entera mientras el tablero cambia de vista.
- **Montar el espacio de trabajo completo dentro del tablero.** Descartada: dobles singletons (historial, selección, buffers), atajos globales duplicados y portal a la barra superior.
- **Una copia reducida de los componentes del Designer.** Descartada por la regla de no bifurcar: se extrajo lo común.

## Consecuencias

- Un usuario puede abrir Create o Tools sin perder borradores del espacio de trabajo; el coste es el guardia de teclas y el cierre automático, que hay que mantener al añadir espacios.
- Los canvases incrustados son más pequeños que los completos: lo que falta (atajos de herramienta, borrar capas, nodos de trazados acotados al tablero) está en [pendientes-gui.md](../pendientes-gui.md).
- Evidencia de tests y de capturas en [039](../history/039-2026-10-W42.md); el layout estrecho de Studio (≤760 px) oculta el tablero.

# 066: visor, historial de versiones y fusión (2026-11-16)

Historial de la jornada del 16 de noviembre en `task/sqlite-adopt`, en orden. Evidencia, no estado actual. Fable
orquestó; Hydrogen y Argon trabajaron por `agy`, GPT 6.1 Terra por `codex`, Grok en Cursor, y Haiku y Sonnet como
subagentes. Hechos completos en el diario de la jornada.

## Origen

La rama tenía la adopción de SQLite en las fases 1 a 4 (Argon), con los 9 hallazgos de Terra ya arreglados por
Hydrogen. Grok la había aprobado en `bus/20261116-grok-revision-arreglos.md`.

Una prueba de usuario nuevo (Haiku, sin contexto) halló cuatro problemas en el visor y el editor: «Revertir» estaba
prometido pero no existía; el botón «Aplicar al original» estaba recortado; «Pintar» estaba escondido; y al recargar
aparecía el aviso «Disk copy… Failed to fetch».

## Secuencia

| # | Qué se hizo y quién | Por qué | Qué reveló |
|---|---|---|---|
| 1 | Hydrogen: «Revertir» en menús y aviso, y popover sin recorte (`0bb7b97a`, `21f35577`), 18 min | La prueba de usuario nuevo | Una función prometida no existía y un botón quedaba recortado |
| 2 | Hydrogen: visor sin panel lateral, «i» flotante, «Pintar» visible, editor en español con el flujo de Google Fotos (`7860bb43`, `100fe827`) | El usuario mostró Google Fotos (guardar o guardar como copia con nota, «¿Descartar cambios?») y Figma Weave (detalles tras «i», imagen grande y centrada) | Referencias concretas para el visor y el editor |
| 3 | Hydrogen: historial de versiones en vez de «Revertir» (`e011f4de` y anteriores), con una extensión de 15 min | El usuario pidió deshacer y rehacer entre versiones, «Volver al original» como salto y que nada se borre | Panel Historial arriba a la derecha y «i» desplegado. Nada se borra |
| 4 | Barra inferior: Hydrogen dejó dos filas en caja; Haiku la rehízo en una fila de texto (`2d8d7714`) | Corregir el apilado | Al simplificar se quitaron los iconos, y los nombres de grupo (Explorar, Reutilizar, Finalizar) no son estándar. Quedó pendiente tras la fusión |
| 5 | Revisión: GPT Terra hizo 3 pasadas incompletas (corte de red; consentimiento de Gentle AI, que se rechazó por decisión del usuario; parada temprana). Arreglos de GPT (`50a2dc78`, `ec4a16b3`). Grok terminó y aprobó (`5b09b347`, `68db6b29`) | Regla 5: revisión independiente | Un revisor que se detiene no se empuja: se cambió a Grok. Grok aprobó la alineación de bytes y puntero, los guardados en cola y el modo accesible de Pintar |
| 6 | Fable fusionó en `task/sqlite-adopt` las ramas usage-fix, agent-fewer-calls, approval-cost, chat-meta, cmd-palette, agent-node-design y system-nodes. Sonnet se cortó por ECONNRESET a mitad; Fable terminó | Integrar el trabajo de la jornada | Conflictos de código: `run_commands` (fewer-calls frente a approval-cost), y `flow/actions.ts` y `agent-commands.test.ts` (system-nodes) |
| 7 | Tras fusionar: `check-docs` (`docs/features/agente.md` pasaba de 30 KB; se dividió en `agente-cambio-modelo.md`, `5d337f3e`); `check-sizes` (`store.ts`, `NodeWorkspace.tsx`, `graph.ts` y `planRun.ts` pasaban de 30 KB; Sonnet movió piezas a módulos nuevos sin tocar la persistencia); dos tests desfasados (node-toolbox y readme-shortcuts, `833079da`) | Los límites de tamaño se rompieron solo al fusionar | Los límites se comprueban tras cada fusión, no solo al final |
| 8 | Fable: `npm test` final con 4044 aprobados y 3 fallos de carga conocidos (path-boolean, pdf-look, writer-lock-panel) | Entregar la rama | Los tres pasan al correrse solos |
| 9 | Limpieza: 20 ramas fusionadas archivadas como etiquetas `archive/2026-11-16/<rama>` y borradas con sus worktrees | Dejar solo las ramas vivas | Quedan `main`, `task/agent-forcing` (app real), `task/sqlite-adopt` (experimental) y `task/workflow-ask-first` |

## Tropiezos mayores

- **Encargos de interfaz mal traducidos.** «Pestañas de texto» quitó los iconos, y después Hydrogen apiló dos filas.
- **Supervisores que se encontraron a sí mismos.** Vigilaban con `pgrep` y patrones de comando: una extensión no dada y
  una espera de `npm test` que nunca terminaba.
- **Red inestable.** Hubo cortes en codex, agy y Sonnet (ECONNRESET).
- **Revisor que se detiene.** GPT se paró tres veces.
- **Herramienta externa que pide consentimiento.** Gentle AI, herramienta del Codex del usuario, pidió consentimiento.
  Se rechazó por decisión del usuario.
- **Límites de tamaño rotos solo al fusionar.**
- **Cuota de Opus casi agotada.**

## Qué aprendimos y medidas

- **Interfaz:** simplificar no quita iconos. Los nombres estándar se comparan con Google Fotos, Canva y Photoshop. Antes
  de dar por buena una UI se mira la captura.
- **Vigilancia:** los workers se vigilan por PID fijo o por el log, nunca por patrón de comando.
- **Red:** commit por parte, informe por parte y reanudar en la misma conversación.
- **Revisión:** si un revisor se detiene, se cambia de revisor en vez de insistir. El alcance de la nueva revisión es
  «solo lo pendiente».
- **Decisiones ajenas:** una herramienta externa que pide consentimiento no se resuelve por el usuario. Se pregunta y la
  decisión queda en el encargo.
- **Tamaños:** `check-docs` y `check-sizes` se corren tras cada fusión.
- **Cuota:** Fable orquesta; Haiku y Sonnet hacen código y pruebas; Grok y GPT revisan.

Notas ponderadas de los workers en `/home/samuel/.local/share/ogs-workers/notas-ponderadas.tsv`. Hydrogen obtuvo 4,06
en revertir, visor e historial.

## Ramas archivadas

Etiquetas `archive/2026-11-16/*`:

- agent-fewer-calls, agent-node-design, approval-cost, chat-meta, claves-seguras-3585fc, cmd-agent, cmd-checks, cmd-fx,
  cmd-library, cmd-nodes, cmd-palette, cmd-sessions, cmd-skills, cmd-studio, commands, export, prompt-cache,
  sqlite-spike, system-nodes, usage-fix.

## Pendiente

- Iconos y nombres estándar en la barra inferior (Explorar, Reutilizar, Finalizar).
- Idioma general de la app.
- Aviso «Disk copy… Failed to fetch» al recargar.
- Descubribilidad: resuelta con «Pintar» visible.
- Migración de datos reales, con copia previa y aprobación explícita del usuario.
- Pasos 11, 13, 14 y 15 de «todo es un nodo».

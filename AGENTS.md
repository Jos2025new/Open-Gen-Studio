# AGENTS.md — Open Gen Studio

## REGLA CRÍTICA — datos del usuario

Los datos y las sesiones del usuario JAMÁS deben exponerse a pérdida. El 2026-10-03 un agente abrió la app real para "revisar una sesión" y su navegador guardó un estado vacío encima de 23 sesiones.

- **Nunca abras la app real (localhost:5173/5174/5175 ni el puerto en uso) en ningún navegador, perfil, extensión, CDP o copia de IndexedDB.** Abrirla basta para que guarde.
- Para revisar sesiones: lee `data/state.json` o `data/backups/` en solo lectura (`python3`/`jq`). Nunca escribas en `data/`.
- Para probar en navegador: solo la copia aislada (otro puerto y otra carpeta `data/` en el scratchpad).
- No toques `data/`, `data/backups/` ni el almacenamiento del navegador del usuario sin su permiso explícito.
- El servidor guarda copias en `data/backups/` (cada 10 min y antes de cualquier guardado que reduzca sesiones) y aparta en `backups/rejected-*.json` un guardado que pierde más de la mitad. No debilites estas protecciones.

## Reglas activas

- Conserva el alcance y las decisiones ya expresadas por el usuario.
- Antes de editar, revisa `git status`, el diff y el código actual; no sobrescribas cambios ajenos.
- Para automatización web usa `agent-browser`: `open`, `snapshot -i`, interactúa con refs, repite el snapshot y termina con `agent-browser close`.
- Si una herramienta `dk-*` cubre una operación multimedia, úsala en vez de reimplementarla. Consulta `--help` ante dudas y no sustituyas la herramienta si falla.
- Usa una sola skill directora por tarea. Con `.specify/`, sigue Spec Kit; sin `.specify/`, no lo inicialices.
- Una revisión no autoriza cambios. Una petición de implementación sí autoriza el cambio acotado y su verificación.
- No ejecutes proveedores de pago sin mostrar el coste máximo y obtener aprobación explícita.
- No confundas typecheck/tests con validación visual o con una ejecución real del proveedor.
- Usa el historial solo cuando haga falta: `docs/AGENTS_HISTORY.md`.

## Estado actual

- Rama activa de trabajo: `better-worflows-xyz765`.
- El historial detallado de tareas, commits, límites y pruebas está en `docs/AGENTS_HISTORY.md`; no lo cargues completo salvo que la tarea lo requiera.

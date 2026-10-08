# AGENTS.md — Open Gen Studio

1. **Datos protegidos con código:** no tocar data/ real; usar npm run dev:sandbox para probar la app. No debilitar las comprobaciones, copias ni rechazos del almacén.
2. **Hecho = evidencia del caso reportado.** Distinguir lectura de código, tests, prueba visual y ejecución de proveedor. Una comprobación general no demuestra que el caso concreto funciona.
3. **Pregunta antes de borrar o migrar datos, cambiar proveedores, gastar dinero, tocar una interfaz ambigua o hacer algo irreversible.** Respetar el alcance y las autorizaciones ya expresadas; una revisión no autoriza implementación.
4. **Antes de cambiar código, mira el archivo en [docs/map.md](docs/map.md).** Si es lado de un contrato, cambia los otros lados en el mismo commit; uno nuevo va a scripts/map-contracts.mjs. Tras cada cambio, `npm run test:related`; al entregar, `npm test`.

## Dónde mirar

- [Índice documental](docs/README.md): features (código y test, o «sin test»), decisiones e historial.
- [Historial](docs/README.md#historial): solo los fragmentos pertinentes, en orden numérico. Es evidencia histórica, no el estado actual del código.
- Persistencia: server/local-store.js, src/lib/disk.ts, src/lib/idb.ts y src/store/store.ts.
- Salvaguardas: scripts/dev-sandbox.mjs y check-*.mjs; npm test los ejecuta, con el mapa, antes de la suite.

## Reglas duras

- Trabaja en un worktree propio (`git worktree add ../ogs-<tarea> -b task/<tarea>`), nunca en la carpeta original: de ella corre la app real. No fusiones: deja la rama lista con `npm test` y repórtala. Si el puerto del sandbox está ocupado, espera o pregunta; no mates procesos ajenos.
- Nada de navegadores automatizados, perfiles, CDP, extensiones ni copias de IndexedDB sobre la app real. No arrancarla para verificar cambios. Las pruebas usan solo el sandbox y terminan deteniéndolo.
- No escribir en data/, sus copias ni el almacenamiento del navegador del usuario. Cualquier borrado o migración requiere aprobación explícita. El sandbox usa .sandbox/data y el puerto 5183; otro puerto con los mismos datos no aísla nada.
- Conservar serialización, baseAt, copias de seguridad, rechazo de pérdida masiva de sesiones y rechazo de escrituras automatizadas.
- Ningún archivo de más de 30 KB. AGENTS.md se mantiene por debajo de 3 KB. Dividir documentación y mantener completo el índice.
- Nada de secretos en docs/ ni en commits. No imprimir valores detectados. Si check-docs falla, parar y reportar.
- Antes de usar proveedores de pago: coste máximo, selección concreta y aprobación explícita. Un coste estimado o mínimo no es un máximo.
- No usar confirm() nativo para acciones de la app; conservar confirmaciones contextuales con cancelación.
- Revisar instrucciones, estado y diff antes de editar; preservar trabajo ajeno. Usar una skill directora y el sistema de planificación existente. Usar dk-* cuando cubra la operación; sus fallos no autorizan reimplementarla.

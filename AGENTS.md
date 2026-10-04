# AGENTS.md — Open Gen Studio

1. **Datos protegidos con código:** no tocar data/ real; usar npm run dev:sandbox para probar la app. No debilitar las comprobaciones, copias ni rechazos del almacén.
2. **Hecho = evidencia del caso reportado.** Distinguir lectura de código, tests, prueba visual y ejecución de proveedor. Una comprobación general no demuestra que el caso concreto funciona.
3. **Pregunta antes de borrar o migrar datos, cambiar proveedores, gastar dinero, tocar una interfaz ambigua o hacer algo irreversible.** Respetar el alcance y las autorizaciones ya expresadas; una revisión no autoriza implementación.

## Dónde mirar

- [Índice documental](docs/README.md): entrada a features, decisiones e historial.
- [Features](docs/README.md#features): afirmaciones con código y test, o «sin test».
- [Decisiones](docs/README.md#decisiones): datos, confirmaciones, sandbox y coste máximo.
- [Historial](docs/README.md#historial): cargar solo los fragmentos pertinentes, en orden numérico. Es evidencia histórica, no descripción garantizada del código actual.
- Persistencia: server/local-store.js, src/lib/disk.ts, src/lib/idb.ts y src/store/store.ts.
- Salvaguardas: scripts/dev-sandbox.mjs, scripts/check-safeguards.mjs y scripts/check-docs.mjs. npm test ejecuta los controles antes de la suite.

## Reglas duras

- Trabaja en un worktree propio (`git worktree add ../ogs-<tarea> -b task/<tarea>`), nunca en la carpeta original: de ella corre la app real. No fusiones: deja la rama lista con `npm test` y repórtala. Si el puerto del sandbox está ocupado, espera o pregunta; no mates el proceso de otro.
- Nada de navegadores automatizados, perfiles, CDP, extensiones ni copias de IndexedDB sobre la app real. No arrancarla para verificar cambios. Las pruebas de la app usan exclusivamente el sandbox y terminan deteniéndolo.
- No escribir en data/, sus copias ni el almacenamiento del navegador del usuario. Cualquier borrado o migración requiere aprobación explícita. El sandbox usa .sandbox/data y el puerto 5183; otro puerto con los mismos datos no aísla nada.
- Conservar serialización, baseAt, copias de seguridad, rechazo de pérdida masiva de sesiones y rechazo de escrituras automatizadas.
- Ningún archivo de más de 30 KB. AGENTS.md se mantiene por debajo de 3 KB. Dividir documentación y mantener completo el índice.
- Nada de secretos en docs/ ni en commits. No imprimir valores detectados. Si check-docs falla, parar y reportar.
- Antes de usar proveedores de pago: coste máximo, selección concreta y aprobación explícita. Un coste estimado o mínimo no es un máximo.
- No usar confirm() nativo para acciones de la app; conservar confirmaciones contextuales con cancelación.
- Revisar instrucciones, estado y diff antes de editar; preservar trabajo ajeno. Usar una skill directora y el sistema de planificación existente. Usar dk-* cuando cubra la operación; sus fallos no autorizan reimplementarla.

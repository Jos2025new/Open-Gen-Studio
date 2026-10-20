# AGENTS.md — Open Gen Studio

1. **Datos protegidos con código:** no tocar data/ real; usar npm run dev:sandbox para probar la app.
2. **Hecho = evidencia del caso reportado.** Distinguir código, tests, prueba visual y proveedor; lo general no demuestra el caso.
3. **Pregunta antes de borrar o migrar datos, cambiar proveedores, gastar dinero, tocar una interfaz ambigua o hacer algo irreversible.** Respetar el alcance y las autorizaciones ya expresadas; una revisión no autoriza implementación.
4. **Antes de cambiar código, mira el archivo en [docs/map.md](docs/map.md).** Si es lado de un contrato, cambia los demás en el mismo commit; uno nuevo va a scripts/map-contracts.mjs. Tras cada cambio, `npm run test:related`; al entregar, `npm test`.
5. **Persistencia protegida:** antes de modificar las zonas o pruebas de docs/persistencia-protegida.md, autorización explícita; conservar contratos y aportar pruebas y revisión independiente.
6. **Identidad visual:** [tarjetas](docs/propuesta-sistema-visual-tarjetas.md) y [temas](docs/propuesta-temas.md) son la identidad: cambiarlas exige aprobación explícita.

## Dónde mirar

- [Índice](docs/README.md): features (código y test, o «sin test»), decisiones e historial.
- [Historial](docs/README.md#historial): lo pertinente, en orden; evidencia, no estado actual.
- [Seguridad](docs/seguridad.md): riesgos reales y descartados; léela antes de avisar.
- Salvaguardas: scripts/dev-sandbox.mjs y check-*.mjs; los corre npm test.
- Rendimiento: [protocolo](docs/depuracion.md#protocolo); si no lo cubre, primero la sonda.

## Reglas duras

- Trabaja en un worktree propio (`git worktree add ../ogs-<t> -b task/<t>`), nunca en la carpeta original, de la que corre la app real. No fusiones: deja la rama lista con `npm test` y repórtala. Sandbox ocupado: espera o pregunta; no mates procesos ajenos.
- Nada de navegadores automatizados, perfiles, CDP, extensiones ni copias de IndexedDB sobre la app real, ni arrancarla. Las pruebas usan solo el sandbox y terminan deteniéndolo.
- No escribir en data/, sus copias ni el almacenamiento del navegador del usuario. Cualquier borrado o migración requiere aprobación explícita. Sandbox: .sandbox/data y puerto 5183; otro puerto con los mismos datos no aísla.
- Conservar serialización, baseAt, copias y el rechazo de pérdidas masivas, escrituras automatizadas y peticiones de fuera del ordenador.
- Archivos ≤ 30 KB; AGENTS.md < 3 KB; dividir docs con índice completo.
- Nada de secretos en docs/ ni en commits; no imprimir valores detectados. Si check-docs falla, parar y reportar.
- Antes de usar proveedores de pago: coste máximo, selección concreta y aprobación explícita. Un coste estimado o mínimo no es un máximo.
- No usar confirm() nativo para acciones de la app; conservar confirmaciones contextuales con cancelación.
- Revisar instrucciones, estado y diff antes de editar; preservar lo ajeno. Usar una skill directora y la planificación existente. Usar dk-* cuando cubra la operación; sus fallos no autorizan reimplementarla.

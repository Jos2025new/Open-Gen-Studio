# Handoff — para la próxima sesión de Claude (nube)

Fecha: 2026-09-26. Escrito por Claude en la sesión local, antes de pasar a Claude en la nube.

## Lee primero
1. `AGENTS.md`: reglas de trabajo (plan antes de operar, un commit por tarea, typecheck + tests) y estado de cada plan.
2. `PLAN_AGENT_ROUTE.md`: el plan activo (R0–R10), con evidencia, dónde, por qué y aceptación.
3. `TRAZABILIDAD.md`: qué se hizo en cada cambio, cómo se verificó y qué falta verificar.

## Quién es el usuario y cómo trabaja
- Samuel. Habla en español; responde en español, claro y sin jerga.
- **No añadir latencia ni carga al modelo del agente.** Es la restricción más importante. Nada de llamadas extra al LLM en el caso normal ni texto que crezca en cada mensaje. Si un cambio lo exige, se para y se pregunta.
- **Coste:** calidad media por defecto; nunca fijar 1080p ni opciones caras sin que él lo pida. Las generaciones de pago requieren su permiso explícito.
- Él hace las pruebas reales (proveedores, navegador, Inkscape). Tú: código, typecheck, tests.
- No quiere sobreingeniería. Antes de un cambio grande, confirma que entendiste.
- Suele traer respuestas de otros agentes (Higgsfield, ImagineArt, Buzzy AI) para comparar. Son autodescripciones, no pruebas: contrasta con la documentación del proveedor y con el código.

## Estado (2026-09-26, sesión en la nube, rama `claude/stoic-davinci-xt7o4z`)
- `PLAN_AGENT_ROUTE.md` implementado en código: R0 (métricas + banco), R1+R2, R3, R4, R5, R6, R7, R9 y R10. Un commit por fase; detalle y límites en `TRAZABILIDAD.md`. 166 tests + banco (se salta sin clave).
- **Falta, lo ejecuta el usuario:** R0d/R8 = el banco antes y después (comandos abajo); pruebas de navegador (tarjeta de preguntas con opción marcada, "Save as subject", chip Subjects con modelos no Kling).
- **Coste de contexto (a revisar con el banco):** el prompt del sistema pasó de 9.620 a 14.768 caracteres (~1.300 tokens más por llamada) y las herramientas de 5.760 a 6.764. Es texto fijo (no crece con la conversación), pero es más que "pocas líneas". Si el banco muestra más tiempo o tokens en peticiones claras, recortar primero las reglas de R1–R3.
- **Sin hacer por falta de fuentes:** guías por modelo de R4 (Wan 3, Seedance, MiniMax H3; estaban en `~/.claude/skills/ai-director/` del usuario). Paso del agente para crear sujetos (R10; se usa "Save as subject").

## Banco (R0d / R8), en la máquina del usuario
Desde la nube `nano-gpt.com` está bloqueado. Antes = commit `3604d48` (R0, sin cambios de comportamiento); después = cabeza de la rama.
```
git worktree add ../ogs-antes 3604d48 && cd ../ogs-antes && npm install
BENCH_LLM_KEY=… npx vitest run tests/bench      # guarda bench/<fecha>-3604d48.json
cd - && BENCH_LLM_KEY=… npx vitest run tests/bench   # guarda bench/<fecha>-<cabeza>.json
```
Imagen del personaje en `bench/fixtures/character.jpg` (o `BENCH_IMAGE=ruta`). Proveedor y modelo: `BENCH_LLM_PROVIDER`, `BENCH_LLM_MODEL`.

## Decisiones pendientes del usuario (pregúntalas antes de la fase que las usa)
1. Calidad = solo resolución: **aplicado provisionalmente** (`mediumResolution`); confirmar.
2. `-spicy` excluidas salvo que se nombren: **aplicado provisionalmente** (`searchIndex`); confirmar.
3. Banco de pruebas: lo ejecuta el usuario (arriba).

## Comandos
- `npm install`, `npx tsc --noEmit -p .`, `npm test`, `npm run build`, `npm run dev` (puerto 5173).
- Guías de prompting por modelo: estaban en la máquina local del usuario (`~/.claude/skills/ai-director/references/models/`), no en el repo. Si hacen falta para R3/R4, pídeselas o usa la documentación oficial de cada proveedor.
- Documentación de proveedores usada hasta ahora: `/home/samuel/Descargas/API DOC` (local, no en el repo). Pídesela al usuario si hace falta.

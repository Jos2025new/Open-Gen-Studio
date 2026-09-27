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
- **Falta, lo ejecuta el usuario:** R0d/R8 = el banco antes y después (comandos abajo); pruebas de navegador (tarjeta de preguntas con opción marcada, "Save as subject", chip Subjects con modelos no Kling, panel Spending, "Continue anyway" al pasar el límite, aviso de modelo sin visión en Ajustes).
- **Gasto (G1–G4, hecho):** el límite avisa y deja continuar, nunca corta algo en curso; el LLM cuenta en todos los tiers; panel Spending en la barra lateral; el agente nunca cae solo a un modelo sin visión.
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

## Actualización 2026-09-26 (Claude Desktop, rama `claude/stoic-davinci-xt7o4z`)
- **Guías de prompting por modelo** en `src/engine/guides/` (Seedance, Wan, MiniMax H3, Grok, HappyHorse, Veo 3.1, FLUX 3, Kling 3.0 y edición de vídeo). El agente las ve en su índice como `model:<id>` y las carga con `read_guide`. Fuentes: producción del usuario, contrastada con los esquemas; las diferencias con cada fuente están en `AGENTS.md` (M1–M10).
- **Citas de referencias corregidas:** Wan `Image 1` (sin @), Grok `<IMAGE_0>`, Gemini Omni `<IMAGE_REF_0>` (ambas desde cero), MiniMax `<Picture 1>` (sin confirmar en una prueba real).
- **Precios:** `PRECIOS_VIDEO.md` (catálogos en vivo, cobros reales del proyecto anterior y presupuesto exacto de Atlas `POST /api/v1/model/calculate`, que funciona sin clave).
- **Siguiente trabajo:** `PLAN_ROUTING_COST.md` (C1–C4). Explica por qué el agente sigue eligiendo Kling y cómo se arregla. Ya no quedan decisiones pendientes: todo está decidido.
- Referencias en la máquina del usuario, no en el repo: `~/Documentos/Projects/AI/My Apps/open-generation-studio/` (skills de prompting, 13 workflows de director, catálogo curado y `data/studio.db` con cobros reales).

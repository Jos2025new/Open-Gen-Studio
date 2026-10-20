# Propuesta: el agente pregunta antes de cargar un workflow, y un encargo no es un pedido de workflow

Fecha: 2026-10-19. Estado: **propuesta y plan, sin implementar**. La ejecutará otro agente.

## Qué observa el usuario

El usuario lo describe así: «la mayoría de las veces el modelo carga un workflow y después pregunta si quiero esto como una imagen o no, o directamente algunas veces se pone en el workflow».

Sus ejemplos:
- «Quiero una chica linda para ver cuál me podría servir para un anuncio…»
- «Quiero tres chicos para un anuncio UGC que tengo en mente…»
- «Deseo una lista de tres chicas posando, que sean bonitas, para unas ideas que tengo…»

Los tres piden **imágenes** (un casting de candidatos). «Para un anuncio» o «para unas ideas» es el **propósito**, no el entregable. Lo correcto es generar las imágenes y, como mucho, ofrecer después el workflow («¿Monto el anuncio UGC con quien elijas?»).

## Causa

Se comprobó leyendo el código de `task/agent-stop` en `fb579b0`.

1. **Las instrucciones se contradicen.**
   - `src/engine/agent/context.ts:46` dice: «si hay una duda real, `ask_questions` una vez; cuando esté claro, `read_guide`».
   - `context.ts:97` dice: «cuando la petición pide o *se parece mucho* a un flujo completo (…UGC…), carga ese workflow». Esa regla empuja a cargar en cuanto aparece una palabra como «anuncio» o «UGC».
2. **Las preguntas están dentro del workflow.** Cada workflow tiene `needs` (`src/engine/skills/types.ts:46`), así que el agente lo carga para saber qué preguntar.
3. **Nada lo impide en código.** El manejador de `read_guide` (`src/engine/agent/runtime.ts:1712`) solo rechaza dos cosas:
   - un workflow de otro canvas (`guideWorkspaceProblem`);
   - una guía de modelo de vídeo antes de la fase 2 (`earlyModelGuide`).

   Esto último es el precedente: una regla dura que responde al agente qué hacer primero.
4. **El encaje es criterio del LLM.** No hay un enrutador determinista. El agente compara la petición con el índice (`guideIndex`, `src/engine/skills/guides.ts:20`). La excepción es un workflow elegido en el compositor, que la app ya adjunta solo después de preguntar (`askFirst`, `runtime.ts:350`).

## Comportamiento propuesto

### 1. Ficha corta antes de preguntar (regla dura)

- Mientras `questionRound === 0` y fuera de Direct, `read_guide("workflow:…")` **no devuelve la guía completa**. Devuelve una ficha de pocas líneas:
  - el nombre;
  - qué entrega (por ejemplo: «un vídeo UGC de 15–30 s, con guion y planos»);
  - sus `needs`;
  - la indicación: «Si la petición no pide esta pieza completa, no es este workflow. Si falta algo material, `ask_questions` primero; si no falta nada, `read_guide` con `ready: true`».
- **`ready: true`** es un parámetro nuevo y opcional de `read_guide`. Con él, el agente declara que la petición está clara y recibe la guía completa en una sola llamada. Así una petición clara no pierde una ronda.
- **Después de una ronda de preguntas** (`questionRound > 0`), la guía completa llega sin más.
- **En Direct** no hay preguntas: la guía completa llega como hoy.
- **Lo que no cambia:** las skills, las guías de modelo y de app, y el workflow elegido en el compositor siguen su camino actual.

### 2. Entregable frente a propósito (instrucción)

- Se sustituye «o se parece mucho a» de `context.ts:97` por una regla explícita:
  > El entregable es lo que la petición pide ahora. «Para un anuncio», «para un UGC», «para unas ideas» es propósito: úsalo para el estilo del prompt, no cargues el workflow. Carga un workflow solo cuando la petición pide la pieza completa («hazme un anuncio UGC», «un vídeo de unboxing»). Si encaja después, ofrécelo al terminar.
- Coste en tokens: mínimo, porque sustituye una línea por otra parecida. Hay que medir el tamaño de `context.ts` con `check-sizes`.

## Plan previsto

Se hace en un worktree propio, `task/workflow-ask-first`, que sale de `task/agent-stop`.

1. **Antes de empezar, confirmar en el código:**
   - dónde se incrementa `questionRound`;
   - cómo se distingue Direct (`composer.agentStyle`);
   - el esquema `readGuideSchema`.
2. **`src/engine/skills/workflowCard.ts`** (nuevo): `workflowCard(id)` devuelve la ficha a partir de `name`, `description` y `needs` del workflow, y la línea de qué entrega. No toca `guides.ts` salvo para exportar lo necesario.
3. **`read_guide`:** añadir `ready?: boolean` a `readGuideSchema` y a la descripción de la herramienta en `src/engine/agent/tools.ts`. En el manejador de `runtime.ts:1712`, junto a `earlyModelGuide`, devolver la ficha si se cumplen las tres condiciones: es un workflow, `questionRound === 0` y no es Direct, sin `ready`.
   - `runtime.ts` tiene 115 400 bytes de un tope de 116 475: la lógica va en `workflowCard.ts` o en `requestGuides.ts`, y en `runtime.ts` solo la llamada.
   - La ficha no cuenta como guía cargada: ni métrica `guide` ni la acción «Read the…» del registro, para que la guía completa se pueda cargar después.
4. **`context.ts`:**
   - la regla de entregable frente a propósito, en lugar de «se parece mucho a»;
   - en la línea 46, añadir que antes de preguntar `read_guide` de un workflow da su ficha.
5. **Tests**, en `tests/workflow-ask-first.test.ts` y `agent-route.test.ts`. Cada uno debe fallar con el código de ahora.
   - Fuera de Direct, con `questionRound === 0`, `read_guide("workflow:ugc")` devuelve la ficha y no la guía.
   - Con `ready: true`, devuelve la guía completa.
   - Con `questionRound > 0`, devuelve la guía completa.
   - En Direct, devuelve la guía completa.
   - Las skills y las guías de modelo no cambian.
   - La ficha no registra la métrica `guide` ni impide cargar la guía después.
   - El `SYSTEM_PROMPT` contiene la regla de entregable frente a propósito y ya no dice «closely resembles».
6. **Comprobación con el LLM real (opcional, con coste):** hay un arnés, `scripts/agent-baseline.mjs`. Correr los tres ejemplos del usuario y comprobar que terminan en un plan de imágenes sin cargar ningún workflow completo, antes y después del cambio.
   - Solo con la aprobación del usuario: modelo concreto y coste máximo, según AGENTS.md.
   - Sin aprobación, se entrega con los tests deterministas y se dice que el comportamiento del LLM no se verificó.
7. **Docs:**
   - la feature del agente que corresponda en `docs/features/`;
   - una entrada de historial enlazada desde `docs/README.md`;
   - si `read_guide`/`ready` es un contrato entre `tools.ts`, `context.ts` y `runtime.ts`, añadirlo a `scripts/map-contracts.mjs` y correr `node scripts/map.mjs --write`.
8. **Verificar:**
   - `npm run test:related` mientras se trabaja;
   - al final, una vez: `npm run typecheck` y `npm test -- --maxWorkers=2`;
   - sin navegador ni sandbox: el cambio no tiene interfaz.

## Límites

- **Zona protegida:** no se toca.
- **No cambia:** los proveedores, el catálogo ni el contenido de los workflows.
- **Riesgo:** una petición clara de pieza completa ahora necesita que el agente use `ready: true`. Si no lo hace, pierde una ronda. Lo cubren el texto de la ficha y la descripción de la herramienta. Si en la práctica pasa a menudo, la alternativa es que la ficha incluya ya la guía cuando el workflow no tiene `needs`.
- **Lo que no garantiza:** que el LLM siempre distinga entregable de propósito. La regla dura impide la guía completa antes de preguntar; la instrucción reduce la confusión, pero no la elimina.

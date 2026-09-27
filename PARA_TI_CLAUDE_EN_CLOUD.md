# Para ti, Claude en Cloud

De: Claude Desktop, 2026-09-26. Samuel vuelve a trabajar contigo en la nube.

## Lo primero
- Trabaja en la rama **`claude/stoic-davinci-xt7o4z`** (subida a GitHub). **No está en `main`**: Samuel decide cuándo se integra.
- Estado: typecheck, build y 190 tests correctos (1 omitido: el banco de pruebas, que necesita su clave). Nada probado en navegador ni con proveedores reales: eso lo hace Samuel.
- Lee en este orden: `AGENTS.md` (reglas y planes con casillas) → **`PLAN_ROUTING_COST.md`** (tu siguiente trabajo) → `PRECIOS_VIDEO.md` → `HANDOFF.md` → `TRAZABILIDAD.md`.

## Tu siguiente trabajo: `PLAN_ROUTING_COST.md` (C1–C4)
Está decidido por completo; no hace falta preguntar nada antes de empezar.
- **Problema:** el agente sigue eligiendo Kling V3 Pro (caro), porque la regla "si no pones modelo, usa el del composer" anula la tabla por propósito, y en el composer quedó Kling como valor por defecto antiguo. Además, los precios de Atlas se muestran al mínimo (480p), y a 720p cuestan unas 2 veces más.
- **Tabla decidida** (solo Atlas y NanoGPT; calidad media; cada fila ordenada siempre por precio):
  - Borrador: MiniMax H3 Max Turbo.
  - Normal: MiniMax H3 Developer → Seedance 2.0 Fast → Wan 3.
  - Toma larga (hasta 30 s): Wan 3.
  - El resto (Seedance 2.5, Veo 3.1, HappyHorse 1.1, Grok 1.5, Gemini Omni, Kling) solo si Samuel lo nombra.
- **Pasos:**
  - **C1.** La tabla en código (`purpose` en el paso; la app elige modelo y proveedor).
  - **C2.** El modelo del composer solo manda si Samuel lo eligió a mano.
  - **C3.** Presupuesto exacto de Atlas, `POST https://api.atlascloud.ai/api/v1/model/calculate`: sin clave y sin coste, devuelve `data.price`, que coincide con el cobro real. Para NanoGPT, mostrar "estimado · cobrado".
  - **C4.** El contexto nombra el modelo por defecto para que el agente cargue su guía.
- **Descartado, no lo hagas:** restar saldos, Request Billing como vía principal, umbrales o calibración automática.

## Cómo trabaja Samuel
- Español claro, sin jerga. Si pide brevedad, sé breve.
- **No añadir latencia ni carga al modelo del agente**: ni llamadas extra al LLM ni texto que crezca con cada mensaje. Si un cambio lo exige, para y pregunta.
- **Presupuesto justo:** calidad media por defecto; nunca 1080p ni opciones caras fijas; siempre la variante más barata (`-developer` de Atlas); ninguna generación de pago sin su permiso.
- **Sin sobreingeniería:** lo mínimo que dé el máximo resultado. Plan en `AGENTS.md` antes de programar, un commit por paso, y tests.
- **Datos duros antes que suposiciones.** Trae respuestas de otros agentes (Higgsfield, ImagineArt, Buzzy, DeepSeek, GPT): son autodescripciones y a veces se equivocan. Contrástalas con los esquemas (`tests/fixtures/live/`), las APIs públicas y los cobros reales.
- Él hace las pruebas de navegador. No abras el navegador salvo que te lo pida.

## Lo que hice en esta sesión (en la rama, ya subido)
- **Guías de prompting por modelo** en `src/engine/guides/`: Seedance, Wan, MiniMax H3, Grok, HappyHorse, Veo 3.1, FLUX 3, Kling 3.0 y edición de vídeo. Índice `model:<id>`, carga con `read_guide`. Cada guía está adaptada a nuestros proveedores; lo que cambié de cada fuente está en `AGENTS.md` (M1–M10).
- **Citas de referencias corregidas** (`refMentionStyle`, `REFERENCE_PROTOCOLS`): Wan `Image 1` (sin @), Grok `<IMAGE_0>`, Gemini Omni `<IMAGE_REF_0>` (ambas desde cero), Seedance `@Image1`. MiniMax usa `<Picture 1>` (guía oficial), pero hay fuentes que dicen otra cosa; sin confirmar en una prueba real.
- **Precios con datos duros** en `PRECIOS_VIDEO.md`: catálogos en vivo, cobros reales y presupuestos exactos de Atlas.

## Pendiente fuera de ese plan
- Guías de imagen: `PLAN_PROMPTING.md` está pendiente de revisión y de las fuentes curadas de Samuel.
- Otras guías de vídeo posibles: Kling O3, Gemini Omni, LTX.
- Workflows de producción: los 13 del proyecto anterior de Samuel sirven de referencia; hay que adaptarlos, no copiarlos.
- Unir clips (el siguiente trabajo candidato), fase 8 (LoRA) y 9 (motion-control) del plan de cobertura.

## Referencias que no están en el repo (en la máquina de Samuel)
`~/Documentos/Projects/AI/My Apps/open-generation-studio/`: skills de prompting, 13 workflows de director, catálogo curado y `data/studio.db` con cobros reales. Si los necesitas, pídeselos a Samuel.

Suerte. — Claude (Desktop)

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

## Estado (todo en `main`, subido a GitHub)
- Hecho y con tests (136 en total):
  - 3D, export y lineart (P1–P9).
  - Agente: `find_models`, indicador de trabajo, revisión de planes pendientes, casillas por paso (A1–A4).
  - Corrección: el agente ya ve las imágenes adjuntas (V1–V3).
- Sin verificar en real (lo hará el usuario): generación 3D, visor, SVG/PDF en Inkscape, que su LLM (GLM 5.3 Flash por NanoGPT) acepte imágenes en formato `image_url`.
- **Siguiente trabajo:** implementar `PLAN_AGENT_ROUTE.md`, empezando por R0 (medir el antes). Orden sugerido: R0 → R1/R2 → R3 → R10 → R4–R7 → R9 → R8.

## Decisiones pendientes del usuario (pregúntalas antes de la fase que las usa)
1. Calidad alta/media/baja: ¿solo resolución, o también variante del modelo? (Media por defecto ya decidido.)
2. Variantes `-spicy` de NanoGPT: ¿se excluyen de `find_models` y de la ruta estándar?
3. Banco de pruebas (R0/R8): permiso para ejecutarlo con su clave del LLM (solo planes, nunca medios).

## Comandos
- `npm install`, `npx tsc --noEmit -p .`, `npm test`, `npm run build`, `npm run dev` (puerto 5173).
- Guías de prompting por modelo: estaban en la máquina local del usuario (`~/.claude/skills/ai-director/references/models/`), no en el repo. Si hacen falta para R3/R4, pídeselas o usa la documentación oficial de cada proveedor.
- Documentación de proveedores usada hasta ahora: `/home/samuel/Descargas/API DOC` (local, no en el repo). Pídesela al usuario si hace falta.

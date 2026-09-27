# Plan: elección de modelo por propósito y precio exacto

Fecha: 2026-09-26. Estado: **decidido, sin implementar**. Rama: `claude/stoic-davinci-xt7o4z`.
Lista de seguimiento: sección C1–C4 de `AGENTS.md`. Datos de precios: `PRECIOS_VIDEO.md`.

## Por qué hace falta
1. **El agente sigue eligiendo Kling V3 Pro**, que es caro. La tabla por propósito de `PLAN_AGENT_ROUTE.md` (R1) quedó solo como texto en el prompt, y otra regla la anula: "si no pones modelo, usa el seleccionado en el composer". En el composer sigue Kling V3 Pro, que era el valor por defecto antiguo y no una elección del usuario (`data/state.json`).
2. **Los precios de Atlas se muestran como mínimo** ("≥"), que es el precio a 480p. A 720p cuesta ~2–2,2 veces más. En la primera prueba real se estimaron 0,055 USD y se cobraron 0,122.
3. **El usuario tiene poco presupuesto.** Solo usa Atlas y NanoGPT (OpenRouter y fal están en la app para quien la use desde GitHub). Quiere la mejor relación calidad–precio y la variante más barata que exista.

## Decisiones del usuario (2026-09-26) y en qué se apoyan
- **Proveedores:** Atlas y NanoGPT. OpenRouter y fal no se usan para esta tabla.
- **Favoritos:** Seedance 2.5, Wan 3, Seedance 2.0, MiniMax H3, HappyHorse 1.1, Veo 3.1 y Grok Imagine Video. Pero la tabla se ordena por **calidad–precio**, sin las variantes Mini. Seedance 2.5 solo para pruebas puntuales.
- **Orden calidad–precio:** Seedance 2.0 Fast > Wan 3 > MiniMax H3.
- **Siempre la opción más barata:** las variantes `-developer` de Atlas van primero cuando existan.
- **Borrador:** MiniMax H3 Max (el usuario lo considera el más rápido).

## Tabla (USD por segundo, precio exacto de Atlas por `POST /api/v1/model/calculate`)
Calidad media por defecto: 720p (768P en MiniMax).

| Propósito | Modelo (orden) | 480p | 720p / 768P | Por qué |
|---|---|---|---|---|
| Borrador | **MiniMax H3 Max Turbo** (decidido: el más barato) | 0,024 | 0,038 | El usuario elige el más barato; Atlas lo describe además como el más rápido del H3 |
| Normal (por defecto) | 1. Seedance 2.0 Fast · 2. Wan 3.0 · 3. MiniMax H3 Developer (puesto pendiente, decisión 2) | 0,027 · 0,040 · 0,015 | 0,058 · 0,080 · 0,024 | Orden de calidad–precio del usuario; H3 Developer es el más barato de todos |
| Toma larga (más de 15 s, hasta 30 s) | Wan 3.0 | — | 0,080 (30 s = 2,40 USD) | Seedance 2.0 Fast no pasa de 15 s; Seedance 2.5 cuesta 0,30/s |
| Solo si el usuario lo pide | Seedance 2.5 (Atlas 0,303), Veo 3.1, HappyHorse 1.1 (NanoGPT 0,082 a 720p; Atlas 0,14), Grok 1.5 Developer (Atlas 0,049), Gemini Omni 1.1 (0,099), Kling V3 std (0,071 sin sonido, 0,107 con sonido) | | | |
| Editar o extender | Operaciones Edit/Extend video con su modelo preferido en Ajustes | | | Sin cambios |

Imagen: queda la tabla de imagen de `PLAN_AGENT_ROUTE.md` (R1) sin cambios, porque sus precios no se han comprobado todavía.

## Qué se hará (un commit por paso; tests; sin llamadas extra al modelo del agente)
- **C1. La tabla en código.** El agente indica el propósito del paso (`purpose: draft | normal | long`) y la app elige modelo y proveedor: la primera variante de la fila que esté conectada y admita las entradas del paso (imagen→vídeo si hay imagen de inicio, referencias si las hay). Si el usuario nombra un modelo, ese manda (ya existe con `find_models` y los nombres de familia). *Por qué:* lo que depende del texto del prompt se ignora; lo que hace la app no.
- **C2. El modelo del composer solo manda si el usuario lo eligió a mano.** Se guarda una marca al elegirlo en el selector. Sin ella, manda la tabla, y el contexto del agente deja de decir "video model: Kling V3 Pro". *Por qué:* hoy un valor por defecto antiguo anula la tabla.
- **C3. Precio exacto.**
  - **Atlas:** antes de generar (composer, nodos y tarjeta del plan), la app pide el presupuesto de la petición real (modelo, duración, resolución, audio). Es una consulta HTTP sin coste y sin clave, no una llamada al modelo. La tarjeta muestra la estimación y la cambia por el precio exacto cuando llega. Ese precio se guarda como coste real, porque coincide con los cobros (Wan 3.0 a 720p, 5 s = 0,40 USD, igual que el cobro real en `open-generation-studio`).
  - **NanoGPT y OpenRouter** ya devuelven el coste real en la respuesta y la app lo guarda. Se añade una línea "estimado X · cobrado Y" cuando no coinciden.
  - *Descartado por sobrearquitectura:* restar saldos antes y después (falla con generaciones simultáneas), Request Billing de NanoGPT (solo haría falta si una respuesta no trae `cost`; queda como plan B) y umbrales o calibración automática.
- **C4. Guías:** el contexto nombra el modelo por defecto de cada propósito, y el agente carga su guía (`read_guide`) la primera vez que lo usa en la conversación. *Por qué:* no añade texto a cada mensaje; cuesta una llamada solo la primera vez.

## Decisiones pendientes del usuario
1. ~~Borrador~~ **Decidido (2026-09-26):** MiniMax H3 Max Turbo, el más barato.
2. **MiniMax H3 Developer:** ¿tercero en la fila normal, o más arriba por precio? Su ficha dice que se sirve desde otra infraestructura ("self-hosted"); su calidad frente al H3 normal no está comprobada.

## Cómo se verifica
Tests: la tabla elige el modelo esperado según el propósito, las entradas y los proveedores conectados; el presupuesto de Atlas se pide con el mismo cuerpo que el envío (fetch simulado); la marca del composer. El usuario prueba en el navegador: el agente ya no elige Kling y la tarjeta muestra el precio exacto de Atlas.

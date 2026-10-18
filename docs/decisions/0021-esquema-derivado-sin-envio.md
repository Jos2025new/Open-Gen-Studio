# 0021 — Nunca enviar una petición de pago con esquema derivado

## Estado

Aceptado

## Fecha

2026-10-18

## Contexto

Cuando el proveedor no entrega el esquema de parámetros de un modelo, la app muestra un esquema «derivado»: un sustituto solo para mostrar, sin campos fiables. Una petición armada con él puede faltar campos obligatorios (prompt, clave de imagen), según el comentario de `src/engine/schemaGuard.ts`. El fallo llegaba al agente como una frase genérica, sin modelo ni error literal, y el agente adivinaba la causa ([042](../history/042-2026-10-W42.md), sección 6). Las pruebas no registran un cobro real por esta causa; el riesgo es el que la regla evita.

## Decisión

Ningún envío de pago se hace con esquema derivado: generación directa, reintento, paso de plan, operación, generación de nodos y vídeo. Todos pasan por `resolveSendable`, que hace una segunda carga del esquema y, si sigue derivado, se detiene con `SchemaUnavailableError` antes de enviar. Los planes y los nodos marcan el modelo antes de mostrar precio. El esquema derivado no se guarda para siempre, y el fallo lleva modelo, proveedor, origen del esquema y error literal.

## Alternativas

- **Enviar igual con el esquema derivado.** Descartada: puede faltar un campo obligatorio y la petición fallaría o se cobraría sin ser lo pedido.
- **Rellenar los campos que faltan con valores por defecto.** Descartada: habría que adivinar el contrato de cada proveedor, y eso es lo que la app no sabe.
- **Ocultar los modelos sin esquema.** Descartada: el usuario no vería por qué falta un modelo ni cómo arreglarlo.

## Consecuencias

- Un modelo cuyo esquema nunca carga no se puede enviar, y su plan no se puede aprobar. El usuario ve una nota con Reintentar. Es el coste aceptado.
- La regla depende de que todos los caminos de envío usen la guarda. Búsqueda de modelos y `confirm_settings` aún no marcan los modelos derivados ([pendientes-gui.md](../pendientes-gui.md)).
- Comportamiento, código y tests en [guarda de esquema](../features/guarda-esquema.md) y [tarjetas del chat](../features/chat-cards.md).

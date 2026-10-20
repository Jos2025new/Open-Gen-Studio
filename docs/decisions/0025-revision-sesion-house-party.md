# 0025 — Revisión de la sesión «house party»: cinco normas del agente y del crédito

## Estado

Aceptado

Implementado en `task/workflow-ask-first`, sin fusionar. Sin verificar en pantalla: lo revisa el usuario en el sandbox.

## Fecha

2026-10-20

## Contexto

Una sesión de prueba en el sandbox (la fiesta en casa) mostró cinco fallos del agente y del crédito. El usuario acordó las normas siguientes; cada una cita el código que la lleva. Detalle de commits y pruebas en el [historial 048](../history/048-2026-10-W43.md#revisión-de-la-sesión-house-party).

## Decisión

**A. El número confirmado vale para cada paso de imagen.** Un paso de imagen sin `count` propio usa el número confirmado en la tarjeta; el número del compositor solo cuenta cuando no hay tarjeta confirmada (generación directa); un `count` que el agente escribe en un paso (el usuario pidió «3 de ella») gana. Antes solo se forzaba con un único paso de imagen y, con varios, cada uno heredaba el del compositor (una tarjeta ×1 produjo 3 por paso).

**B. Una revisión del plan conserva estilo y continuidad.** Con `revision: true`, el `style` o la `continuity` omitidos se copian del plan revisado; si el agente los escribe, gana lo suyo. La respuesta de la herramienta le dice qué se conservó. Las entradas de continuidad que apuntan a pasos retirados se descartan y se avisa.

**C. El crédito busca el equivalente.** Un candidato sirve si acepta al menos las entradas que necesita el modelo actual (uno que admite imagen puede hacer un trabajo de texto; uno solo de texto no puede hacer uno con imagen). El cambio automático sigue siendo solo para la misma línea de modelo al mismo precio o menos. No se ofrece nada a más de 1,5 veces el precio del modelo que falló (misma unidad); lo que cuesta más pero menos que eso se marca «pricier».

(D y E se añaden con sus commits: pedir cambio de modelo o de proveedor, y el aspecto por entregable.)

## Alternativas

C: exigir igualdad de `acceptsImage` (descartado: excluía la copia equivalente de otro proveedor y ofrecía un miembro más caro de la familia).

## Consecuencias

- `creditOptions` expone `ratio`; el aviso marca lo más caro.
- Pruebas en `tests/credit.test.ts`.

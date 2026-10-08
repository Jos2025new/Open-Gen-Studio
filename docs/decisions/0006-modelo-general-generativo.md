# 0006 — Modelo general generativo: automatización por coste y intentos enlazados

## Estado

Propuesto

## Fecha

2026-10-07

## Contexto

El modelo general separa operación (qué se pide) e intento (una corrida concreta), y decide la automatización por impacto, detectabilidad y reversibilidad, no solo por confianza (§11). Una primera implementación dejó `needsConfirmation` sin uso en el flujo real y reintentaba creando un registro que nadie enlazaba: el resultado quedaba oculto y el reintento se cobraba otra vez.

## Decisión

1. **Gate por coste tras normalizar el plan.** Un tipo nunca confirmado bloquea antes de normalizar (sin cambios). Después, con el coste y los candidatos conocidos, `needsConfirmation` decide: pedir la tarjeta si el coste es desconocido o superior a 0,50 USD; mostrar el plan sin tarjeta si hay elección del usuario (modelo nombrado, vídeo o varios candidatos); automatizar en el resto. El umbral de 0,50 USD lo fijó la implementación y es editable en `LOW_COST_USD`.
2. **Ajustes confirmados persisten en la sesión.** Se reutilizan solo a través del gate anterior. Revierte la regla previa de «ajustes solo para la petición», que evitaba aplicar en silencio valores antiguos; el gate por coste sustituye esa garantía.
3. **Reintento = intento nuevo enlazado.** `retryGeneration` crea un registro con el mismo `operationId`, relinka el nodo, la tarjeta del chat y el paso del plan, y conserva el registro fallido como historial.

## Alternativas

- Mantener la regla «ajustes solo para la petición»: rechazado, porque impide la reutilización que pide el modelo (Fase 1) y obliga a la tarjeta en cada petición.
- Decidir por coste antes de normalizar: rechazado, porque el coste solo es conocido tras normalizar y estimar el plan.

## Consecuencias

- En Auto y Guided, un plan caro o de coste desconocido no llega al feed hasta que el usuario confirma ajustes.
- En Direct ([0007](0007-modos-y-encaje-del-agente.md), decisión 1) este gate no se aplica: `presentPlan` omite `needsConfirmation` cuando el modo es Direct, así que un plan caro o de coste desconocido llega al feed y su tarjeta de aprobación es el control antes de generar. La autorización de gasto sigue siendo independiente.
- Los planes con vídeo o varios candidatos se muestran en la tarjeta de aprobación en lugar de pedir ajustes.
- La aprobación del plan y la autorización de gasto siguen siendo independientes (SETTINGS_POLICY).
- Límites: el umbral y la reversión de la regla de ajustes necesitan aprobación del usuario. No se implementan traits, Project, Export/Assemble, estado outdated ni decisiones editoriales por contexto; no hay caso real que los exija todavía. No hay prueba en sandbox ni con proveedores reales de los tres recorridos (una imagen suelta, «ahora en un sofá» y regenerar un nodo).

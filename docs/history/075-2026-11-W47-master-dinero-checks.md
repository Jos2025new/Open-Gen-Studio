# 075 · Dinero crítico, checks de disciplina, recarga y lienzo (sesión maestra 7, 2026-11-22)

Rama `task/integra-7` (worktree `ogs-integra7`), fusionada en `main` (`819ed2fc`) y subida con el sí del usuario. Lista de trabajo: bus `20261122-master6-orden-prioridad.md`. Evidencia, no estado actual.

## Fusionado (puntos 1-8 y 11-12)
- **Un solo veredicto de presupuesto** (punto 1): `budgetVerdict` en `budget.ts` es la única regla. «Continue once» es un `BudgetPass` de la acción, no de la sesión: otra acción no lo ve ni lo gasta. `check-budget-verdict.mjs` impide importarlo fuera de `budget.ts`, `credit.ts` y `useBudgetVerdict`.
- **Lock de nodo en `runInNodes`** (punto 2), con test de carrera.
- **Sin precio nunca es $0** (punto 3): `addSpend(null)` marca `unknownPrice`; el registro y el contador muestran «≥$X» o «Price unknown». Un 402 con sustituto solo pasa si su precio es conocido y no supera lo aprobado.
- **Checks en `npm test`** (punto 4): `check-test-discovery` (todo `*.test.*` corre), `check-media-literals`, trinquete de tamaño (aviso al 90 %, base contra HEAD) y `check-it-fails` (cada `it.fails` lleva `// reproduce:`, por AST).
- **`MEDIA_KINDS`** (punto 5) en todos los enums de medio; **una tabla de nodos de sistema** (punto 6): `SYSTEM_DEFAULTS` y `SYSTEM_UIS`/`SYSTEM_MENU_ORDER` comprobados por tipo.
- **`llmTurn.ts` dividido** (punto 7) en `turnGuard`, `turnUsage`, `turnModelCall`, `turnToolLoop` y `proposePlanCall`.
- **Cierre de plan** (punto 8, decisión del usuario): el resumen vuelve a preguntar al pasar el tope, con «Continue once» y «Don't ask again»; con «Don't ask in any session» se pregunta una vez.
- **`exhaustive-deps` es error** en `src/components/node/**` (punto 11) y los `it.fails` dicen qué reproducen (punto 12).
- **Ataques:** Neon, Hydrogen y Sonnet llegaron a «fusionable sí». Sonnet encontró 5 huecos de dinero (lote mixto guardado como exacto, «gastado $0» sin precio, pase huérfano, 402 preguntando dos veces, sustituto más caro); Neon los cerró. Neon encontró que la división de `llmTurn` usaba el espacio de trabajo viejo; Sonnet lo arregló.
- **`npm test` completo:** 1 fallo (`step-kind-tables`, `PlanStep` movido a `planFeedTypes.ts`), arreglado en `726367a6`; no se volvió a correr entero.

## Puntos 9 y 10 (ramas `task/p9-7` y `task/p10-7`)
- **9, aprobaciones al recargar (fail-closed):** la tarjeta de aprobación y el aviso de tope siguen a la vista tras recargar y se aprueban con un clic; una tarjeta `running` huérfana vuelve a «esperando» con nota de recarga. 9 tests rojos con `src` revertido.
- **10, lienzo:** los nodos nuevos buscan sitio libre (tarjeta + panel flotante) en vez de apilarse; zona de clic de 24 px en handles, igual aspecto.
- **Sin fusionar.** Haiku atacó ambas (bus `20261122-haiku-ataca-p9.md` y `-p10.md`): «fusionable no».
  - p9: doble envío al re-aprobar una secuencia ya enviada en parte (`commandCalls.ts:93`, crítico, nuevo) y plan de nodos aprobado sin enviar que cierra en error (`settlePlans.ts:54`). Tests rojos en `task/p9-7-ataque` (`67505d9d`).
  - p10: un puerto oculto sigue clicable por la zona de 24 px (alta, nuevo) y un nodo nuevo cae bajo el panel de otro (media, nuevo), más 5 menores. Tests en `task/p10-7-ataque` (`9fab83bb`).
  - Sonnet los arregla en `task/p9-7` y `task/p10-7` (bus `20261122-sonnet-arregla-p9.md` y `-p10.md`). Falta re-ataque de otro modelo, integración y un `npm test`.

## Lecciones
1. **Una sola corrida de agy a la vez:** una segunda la interrumpe (`"error":"interrupted"`). Neon e Hydrogen comparten cuota.
2. **Los checks nuevos tenían huecos** (alias, `it.extend`, modificadores, uniones TS): un check también se ataca.
3. **Sol sin cuota toda la sesión:** plan B con Neon, Hydrogen y Sonnet; Haiku como atacante cuando Gemini no tiene cuota.

## Hallazgos heredados para la próxima sesión (medios, Haiku en sandbox)
- El planificador local recorta a 4 imágenes sin avisar.
- Un fallo de copia a disco deja una generación local en error sin Reintentar.
- El campo de tope acepta 0, 1e20 y -5 sin aviso.
- Local Sketch sin etiqueta «Free»; «Reset» del gasto sin respuesta visible.
- La línea hacia Vídeo es muy corta y la salida se oculta en reposo.
- Después: 073 puntos 3 a 7.

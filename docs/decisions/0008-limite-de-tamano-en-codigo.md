# 0008 — Límite de 30 KB en el código: los archivos que ya lo superan no crecen

## Estado

Propuesto

## Fecha

2026-10-07

## Contexto

`AGENTS.md` prohíbe archivos de más de 30 KB, pero solo `check-docs` lo comprobaba, y solo en `docs/`. Al revisar la sesión del historial 019 aparecieron 13 archivos de `src/` por encima del límite, algunos muy por encima (`runtime.ts`, 116 KB), y la sesión hizo crecer seis de ellos sin que ningún control lo detectara. Partirlos ahora sería una refactorización grande del núcleo del agente con ramas sin fusionar encima. El usuario delegó la elección en lo más coherente con las reglas del proyecto.

## Decisión

1. **Control nuevo `scripts/check-sizes.mjs`, dentro de `npm test`.** Mide todo archivo versionado o nuevo no ignorado.
2. **Un archivo nuevo, o que estaba por debajo, no pasa de 30 000 bytes**, la misma cifra que `check-docs`.
3. **Los 13 que ya lo superaban quedan en `scripts/size-baseline.json` con su tamaño del 2026-10-07.** Pueden bajar y no pueden crecer. Un cambio en ellos que añade código tiene que extraer otro tanto a un módulo nuevo.
4. **Exentos los archivos generados:** `package-lock.json`, `tests/fixtures/` y `bench/`. Los regeneran `npm install`, `npm run snapshot:models` y el banco; un límite solo bloquearía una actualización legítima.

## Alternativas

- **Partir `runtime.ts` y el resto ya.** No se adopta: el riesgo y el conflicto con `task/agent-direct` y `task/agent-triggers` no compensan frente a un control que impide empeorar.
- **Dejarlo solo documentado.** No se adopta: la regla seguiría sin aplicarse en `src/` y el crecimiento solo se vería en una revisión manual.
- **Subir el límite del código.** No se adopta: contradice `AGENTS.md`.

## Consecuencias

- `npm test` falla si un archivo de la lista crece, aunque sea un byte, y lo nombra con su tamaño de referencia.
- Cuando un archivo baja, su referencia puede bajarse en el mismo commit. Subirla equivale a debilitar el control y requiere aprobación.
- El control no parte nada. Reducir los 13 archivos sigue pendiente; es trabajo aparte, archivo por archivo.
- Una rama creada antes de este control que haga crecer esos archivos fallará al integrarse con él. Habrá que extraer código antes de fusionar.

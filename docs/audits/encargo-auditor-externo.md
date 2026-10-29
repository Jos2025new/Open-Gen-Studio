# Encargo para un auditor externo (2026-10-28)

Texto listo para entregar. El auditor no ha participado en el código ni en los documentos.

## Versión

Rama `task/designer-measure`, commit `a4377c9` (o el que se indique al entregar). Revisa exactamente esa versión y cítala en el informe.

## Lee primero

`AGENTS.md`, y después, por área: `docs/designer-controles/README.md`, `docs/studio-controles/README.md` y `docs/nodes-controles/README.md`, con sus `huecos.md` y `hallazgos.md`, y `docs/rastreo/README.md`.

## Parte 1: comprobar los documentos

- Contrasta afirmaciones concretas con el código. Por cada discrepancia, cita la frase del documento (archivo:línea) y el código que la contradice (archivo:línea o símbolo).
- Estados que usan los documentos: «respondido por lectura», «respondido parcialmente», «requiere prueba», «requiere decisión», «sin decisión encontrada». Señala los que contradigan el código o su propia frase.
- Prioridad: lo que toque las promesas P1 (el modelo o proveedor no cambia sin que el usuario pulse Cambiar), P2 (no gastar por encima de lo mostrado; una estimación no es un máximo) y P3 (ningún aviso afirma algo falso).

## Parte 2: buscar un bug

- Intenta reproducir un fallo real. No hace falta encontrar uno: una sospecha que no se reproduce también es un resultado útil.
- Si lo encuentras: caso mínimo (pasos), resultado esperado y obtenido, impacto y archivo:línea de la causa si la ves.
- Pistas opcionales (no son una lista cerrada; busca también fuera de ella):
  - Nodes: tras borrar un resultado o duplicar un nodo, una conexión entrega otra imagen.
  - Nodes: en operaciones de imagen, el modelo con que se estima el precio no es el que se ejecuta.
  - Designer: con la variante Edit abierta, las teclas R, O, L o M cambian de herramienta y la tira contextual muestra controles que el registro da por no alcanzables.

## Límites duros

- Solo el sandbox: `npm run dev:sandbox` (puerto 5183, datos en `.sandbox/data`). Nunca `data/`, la app real ni el almacenamiento del navegador del usuario. Detén el sandbox al terminar.
- Ningún gasto: no configures claves de proveedores reales. El agente debe usar el motor local sin coste (`src/engine/agent/offlineTurn.ts`); las llamadas del agente también cuentan como gasto. Hoy no hay proveedor de generación simulado: lo que exija generar de verdad, déjalo como «requiere prueba con proveedor» y no lo ejecutes.
- No edites código ni documentos; no hagas commits.

## Informe

Un solo archivo, `docs/audits/auditoria-externa-2026-10-29.md` (si existe, sufijo `-2`). Separa en cada punto cómo se comprobó: **lectura**, **prueba automatizada** o **uso visual en el sandbox**. Sin resúmenes generales: solo hallazgos con su evidencia.

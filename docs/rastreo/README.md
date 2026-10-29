---
type: index
title: Rastreo de historia por área
description: Pendientes, frágiles, decisiones revertidas, regresiones y contradicciones de Designer, Studio y Nodes, verificados contra el código
tags: [rastreo, designer, studio, nodes]
updated: 2026-10-28
---

# Rastreo de historia por área

Rastreo de commits y docs para cada área, con el estado de hoy comprobado en el código (2026-10-28). Los docs y los mensajes de commit son pistas; la evidencia es el código. Lo que solo se ve en pantalla queda «sin verificar».

- [Designer](designer.md): 17 pendientes, 12 decisiones revertidas, 8 regresiones, 10 contradicciones. Registro: [designer-controles](../designer-controles/README.md).
- [Studio, secciones 1–2](studio.md) y [Studio, secciones 3–5](studio-2.md): 43 pendientes, 20 decisiones revertidas, 15 regresiones, 13 contradicciones. Registro: [studio-controles](../studio-controles/README.md).
- [Nodes](nodes.md): 20 pendientes, 7 decisiones revertidas, 10 regresiones, 9 contradicciones. Registro: [nodes-controles](../nodes-controles/README.md).

## Pendiente (2026-10-28)

En pausa por decisión del usuario: antes quiere automatizar más pruebas o corroborar detalles. Nada de lo siguiente está hecho.

1. **Dos reproducciones de Nodes, gratuitas y aisladas** (pruebas sin gasto ni datos reales), antes de arreglar nada:
   - Imagen equivocada: borrar un resultado ([nodes.md](nodes.md), 3.6) o duplicar un nodo / soltar un cable en el fondo (3.5) deja una conexión apuntando a otro resultado.
   - Modelo distinto: en una operación de imagen, la estimación usa `params._modelRef` (`executor.ts:87`) y la ejecución prioriza la elección calculada desde el origen (`flow/actions.ts:217-228`, `jobs.ts:1074`); la autorización de precio (`priceAuthorization.ts:33`) no frena cualquier cambio.
2. **Decisiones de producto que presentar con sus efectos concretos** antes de cambiar comportamiento: cambio automático de proveedor por capacidad (`providerFit.ts:41-55`, [studio-2.md](studio-2.md) R1), por crédito con `modelPinned: true` (`credit.ts:204-211`), reconfirmación a 0,50 USD quitada en Auto (`2120c71`), `edit_node` sin tarjeta.
3. **Promesas de gasto que aclarar**: límite con precios desconocidos (`budget.ts:24`), revisiones y «Ajustar prompt» sin precio previo, «Approve anyway» explicado solo en la ayuda emergente, cancelación con trabajo remoto en curso (cobro sin verificar).
4. **Actualizar docs que describen decisiones sustituidas** (lista en la sección 5 de cada rastreo).
5. **Pasar a los registros lo que el rastreo responde** (no cambia filas de control, sí notas de hallazgos y huecos):
   - Designer: la rama de texto de la tira es código muerto desde `f11a0dd` (hoy «no alcanzable por lectura»); la ayuda de Polygon dice «Sides»; Sculpt sin icono; `.align-action-row` es de 5 columnas (responde a huecos).
   - Studio: el cambio por crédito fue deliberado (`4cf18aa`, ADR 0025 C); el de capacidad no tiene decisión citada.
   - Nodes: respuestas a H1–H17 de la sección 4 de [nodes.md](nodes.md). Ya aplicadas: H1, H2 y H10 (commit `699e479`).

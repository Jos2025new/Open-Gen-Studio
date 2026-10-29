---
type: huecos
title: Huecos de Nodes
description: Lo que esta auditoría de Nodes no leyó o no pudo confirmar sin ejecutar, y las pruebas que lo cerrarían.
tags: [nodes, huecos]
updated: 2026-10-28
related: [hallazgos, dependencias]
---
# Huecos de Nodes

Esta auditoría es de **lectura de código**. No cubre comportamiento en pantalla, rendimiento ni proveedores. Cada punto necesita la prueba indicada en el sandbox (`npm run dev:sandbox`, puerto 5183), nunca en la app real.

| Hueco | Qué falta | Prueba que lo cierra |
| --- | --- | --- |
| Comportamiento real del agente con `edit_node.model_ref` (H1) | La política (`changeRules.ts`) está leída; falta ver si un agente cambia el modelo por su cuenta | Reproducir en el sandbox con una petición ambigua |
| Efecto real de los ajustes ocultos copiados al nodo (H8) | No se siguió la ruta hasta la petición al proveedor | Ejecutar un nodo con realismo activo y comparar la petición |
| Ejecución de `edit_region`, `remove_object`, `create_voice` desde un nodo (H12) | No se leyó el ejecutor | Ejecutarlos en el sandbox con un proveedor de coste 0 o simulado |
| Validación de campos `required` (H13) | Solo se leyó la interfaz | Ejecutar una operación con un campo vacío |
| Recuperación tras recargar durante una ejecución y cancelación desde otras superficies (H11) | Stop/Comprobar por nodo no existen en `components/node`; falta ver el hilo | Ejecutar, recargar y cancelar en el sandbox |
| Coste de `previewRun` en cada cambio (H14) | No medido | Sonda según docs/depuracion.md |
| Formato de guardado de `graph` y migraciones | No se leyó la persistencia | Leer `docs/persistencia-protegida.md` (zona protegida: solo lectura) |
| Marca visual de nodo desactualizado (H15) | Podría existir en estilos no leídos | Buscar en CSS y capturar |
| Efecto de borrar un asset sobre un nodo de generación que lo tiene como resultado | Solo se leyó el caso del nodo Asset | Borrar en el sandbox |
| Accesibilidad por teclado del lienzo (foco, flechas) | No se auditó | Prueba con teclado en el sandbox |

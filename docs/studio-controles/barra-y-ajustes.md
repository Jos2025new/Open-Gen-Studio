---
type: inventario
title: Barra superior y ajustes en Studio
description: Controles de la barra superior que actúan en Studio y pestañas Agent y Budget de Settings que gobiernan el agente, el límite y el margen de precio.
tags: [studio, topbar, settings, presupuesto]
updated: 2026-10-28
related: [composer, tarjeta-plan, dependencias, estado-compartido]
---
# Barra superior y ajustes en Studio

La barra y Settings son compartidas con los otros lienzos. Aquí solo lo que cambia el comportamiento de Studio. Las demás pestañas de Settings (Providers, Operations, Look, Keys, Data) quedan en [huecos](huecos.md).

## Barra superior (`TopBar.tsx`)

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Home | `TopBar.tsx:95` | Siempre | `openHome` | `ui.home` | Cubre el lienzo con Home | Con Home abierto, el teclado lo filtra `homeGuard` ([atajos-gestos](atajos-gestos.md)) |
| Back to {lienzo} | `TopBar.tsx:36,93` | Home abierto y hay sesión | `workspace`, `title` | `ui.home=false` | Vuelve a Studio | Esc hace lo mismo salvo con campo enfocado, popover, panel, lightbox o Settings abiertos (`:67-79`) |
| Switch workspace («Canvases») | `TopBar.tsx:96-99` | Siempre | `workspace` | `ui.workspace` | Cambia entre Studio, Nodes y Designer | Cambia el lienzo, no el tablero de Studio |
| Título de sesión (editable) | `TopBar.tsx:118` | Hay sesión | `title`, `editing` | Nombre de la sesión | Lista de sesiones | Borrador local `draft` hasta confirmar |
| SessionSwitcher | `TopBar.tsx:121` | Hay sesión | `activeId` | Sesión activa | Chat, agente y tablero de esa sesión | Contenido sin inventariar |
| New session | `TopBar.tsx:124` | Siempre | `newSession` | Crea sesión | Chat vacío | Sin confirmación |
| Connected | `TopBar.tsx:135-142` | Siempre (en Home es una píldora) | Proveedores con clave | Abre popover de proveedores | Qué proveedores puede usar el agente | Indicador `pool-dot` encendido si hay alguno |
| Generations | `TopBar.tsx:138,145` | Fuera de Home | Cola de trabajos | Abre popover de 680 px | Seguimiento de trabajos | Cierra los otros popovers al abrir |
| Settings | `TopBar.tsx:140,148` | Siempre | `settingsOpen` | `ui.settingsOpen` | Panel de 400 px con pestañas | Cierra Connected y Generations al abrir |

## Settings: pestaña Agent (`SettingsPanel.tsx:351`)

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Engine | `SettingsPanel.tsx:353` | Siempre | Motores disponibles | `settings.agent.engine` | Qué LLM dirige el agente | Cambiarlo no toca modelos de imagen |
| Tier (Normal/Top) | `SettingsPanel.tsx:359-362` | Motor con niveles | `agent.tier` | Tier y `modelPinned=false` | Director por defecto | El tooltip lista los modelos de cada nivel |
| Model | `SettingsPanel.tsx:376` | Motor con selector | Catálogo | Modelo del Director | Cada turno del agente | Elegirlo es la acción explícita del usuario |
| Reasoning | `SettingsPanel.tsx:387-390` | Modelos con razonamiento | Modelo | `agent.reasoning` | Latencia y coste del turno | «None» salta el pensamiento donde se puede |
| Show thinking | `SettingsPanel.tsx:403-406` | Siempre | `agent.showThinking` | Visibilidad del razonamiento | ActivityBlock del chat ([chat-estudio](chat-estudio.md)) | El tooltip dice que no cuesta |
| Update the composer's default model when I change the model in a session | `SettingsPanel.tsx:418-425` | Siempre | `agent.updateComposerDefaults` (defecto: apagado) | Casilla | `rememberSessionModel` empuja el modelo de sesión al defecto del Composer | Ver [dependencias](dependencias.md#modelo-del-composer-de-la-sesión-y-de-la-tarjeta) |
| Guided rounds 1/2/3 | `SettingsPanel.tsx:427-430` | Siempre | `settings.guidedRounds` (defecto 2) | Rondas de preguntas | `roundsFor` en [tarjeta-preguntas](tarjeta-preguntas.md) | Solo afecta al estilo Guided |

## Settings: pestaña Budget (`SettingsPanel.tsx:458`)

| Control | Dónde aparece | Cuándo aparece | De qué depende | Qué modifica | Influye en | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| Spending limit On/Off | `SettingsPanel.tsx:460-463` | Siempre | `budgetOn` (defecto encendido) | `settings.budgetOn` | `overLimit` en `budget.ts` | El tooltip dice «a run that goes over it asks first»; ver hallazgo de precios desconocidos |
| Limit (USD) | `SettingsPanel.tsx:475` | Límite encendido | `budgetUsd` (defecto 25) | Redondea a centavos al salir del campo | `overLimit`, `SpendConfirm`, aprobar plan | Un valor inválido restaura el anterior |
| Price margin 5/25/50/Off | `SettingsPanel.tsx:491-494` | Siempre | `priceMargin()` | `settings.priceMargin` | Revisión de pasos en [tarjeta-plan](tarjeta-plan.md) | Off: corre y la tarjeta muestra la diferencia |
| Spent | `SettingsPanel.tsx:502` | Siempre | `spentUsd` | Solo lectura | Comparación con el límite | Incluye llamadas del agente (nota al pie) |
| Reset | `SettingsPanel.tsx:504-513` | Siempre | Estado | `spentUsd=0` y `budgetAccepted=null` | Vuelve a preguntar tras haber aceptado pasarse | El historial queda en el panel Spending |
| Nota «You chose to continue past this limit» | `SettingsPanel.tsx:516` | `budgetAccepted === budgetUsd` | Aceptación previa | Informativa | Avisa de que ya no se pregunta | Se limpia cambiando el límite o con Reset |
| Enlace Spending | `SettingsPanel.tsx:520` | Siempre | — | `ui.panel='spending'` | Abre `SpendingPanel` (gasto por periodo) | Cierra Settings |

## Enlaces

[README](README.md) · [composer](composer.md) · [tarjeta-plan](tarjeta-plan.md) · [dependencias](dependencias.md) · [estado-compartido](estado-compartido.md) · [hallazgos](hallazgos.md) · [huecos](huecos.md)

Wikilinks: [[composer]] · [[tarjeta-plan]] · [[dependencias]] · [[estado-compartido]] · [[hallazgos]] · [[huecos]]

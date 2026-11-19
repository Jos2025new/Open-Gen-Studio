# Prueba de usuario nuevo antes de fusionar (Haiku sin contexto, 2026-11-19)

Hecha en el sandbox (puerto 5183, `.sandbox/data`), sin claves de API y sin aprobar ningún gasto. Capturas en `~/.local/share/ogs-workers/logs/haiku-final/`, de `01` a `25`. Código en `4d5fd436`.

## Por tarea

1. **Encontrar el lienzo de nodos.** Conseguido: botón «Omnicanvas» del menú izquierdo. Nada indica que ese es el lienzo.
2. **Dos agentes con su chat.** Parcial.
   - El primer clic de «Add node» no añadió nada y no avisó.
   - Al conectar un agente al chat aparece «Send messages to» con dos opciones, ambas llamadas «Agent», que no se distinguen.
3. **Mensaje y Stop.** Parcial. Sin clave contestó al instante el planificador local («modo local, sin LLM»), y Stop no llegó a verse. No se pudo confirmar a qué agente fue el mensaje.
4. **Texto, imagen y Run.** Parcial.
   - Haiku no logró crear el cable arrastrando; probablemente es una limitación de la herramienta.
   - «Run all» mostró la confirmación: «Run 2 nodes · Free», con el aviso «Image needs a prompt» y el botón deshabilitado. Cancelado.
5. **Borrar y deshacer.** Conseguido: el nodo desapareció y Ctrl+Z lo devolvió con sus cables.
6. **Puerto incompatible.** No concluyente: el cable no apareció y no hubo aviso.

## Fricción señalada

- Puertos muy pequeños con el zoom por defecto.
- Dos «Agent» iguales en el selector de destinatario.
- El popup del nodo de imagen tapa el lienzo.
- «Run all» confirma todos los nodos.
- No siempre hay confirmación visual de lo añadido.

## Errores visibles

Ninguno en rojo y nada roto.

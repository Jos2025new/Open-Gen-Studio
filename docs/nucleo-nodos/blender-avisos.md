# Cómo resuelve Blender 5.2.3 los avisos, los cables inválidos y los grupos

Lectura del código fuente (solo lectura, 2026-11-19). Código parcial en `~/Descargas/blender-src-nodos/source/blender/`. Las líneas son aproximadas, ±2. La sesión maestra comprobó: `drawnode.cc:2118` (cable en `TH_REDALERT`), `eval_log.cc:548` (los avisos suben al nodo grupo) y `node_select.cc:1430,1516` (la búsqueda indexa los avisos).

## Avisos en el nodo
- Hay tres niveles: `Error`, `Warning` e `Info` (`nodes/NOD_geometry_nodes_warning.hh:12-16`). Su valor numérico es fijo porque se guarda en el archivo.
- La cabecera muestra solo el icono del aviso más grave (`node_draw.cc:2110,2160-2235`).
- El tooltip lista todos los avisos, uno por línea (`node_errors_tooltip_fn`, `node_draw.cc:2125`).
- Los avisos viven en un log de evaluación en memoria, no persistente (`NOD_eval_log.hh:69-82,328,390`). Los duplicados se colapsan por tipo y mensaje.
- Un nodo de tipo desconocido, o un grupo que falta, se pinta con la cabecera de color de aviso y el contorno rojo (`node_draw.cc:2751,2789,3344`). Es un canal visual distinto del icono.

## Cables inválidos
- La validez se calcula en una sola pasada tras cada cambio (`node_tree_update.cc:575,1455-1530`). Se prueban los motivos en este orden y vale el primero:
  1. el socket no está disponible;
  2. conflicto de menús;
  3. ciclo;
  4. conversión de tipo no soportada;
  5. el cable sale de una zona;
  6. forma de dato incompatible (campo frente a valor).
- Si el tipo es dinámico no se marca nada, para evitar falsos positivos.
- El motivo se guarda aparte, en un mapa de cable a motivos (`BKE_node_runtime.hh:74,199`).
- Un cable inválido se dibuja entero en rojo (`drawnode.cc:2118,2410-2440`), con el mismo grosor. En el centro del cable lleva un icono rojo cuyo tooltip lista los motivos con viñetas (`node_draw.cc:4436-4500`).
- Un cable discontinuo no indica error: indica la clase de dato (campo).
- En la ejecución, el cable inválido se conserva en el grafo pero se trata como si no existiera (`node_exec.cc:265`).

## Entradas obligatorias
- No existen. Una entrada sin cable usa su valor por defecto. Si falta algo, el nodo emite un aviso normal al evaluar; el socket no lleva ninguna señal.

## Propagación
- Hacia abajo no se propaga nada: solo el nodo que falla muestra el aviso.
- Hacia arriba en la jerarquía, el nodo grupo hereda los avisos de su interior (`eval_log.cc:506-557`, línea 548).
- Cada nodo tiene un filtro de lo que propaga: todo, nada, solo errores, o errores y avisos (`DNA_node_types.h:195-200`).

## Escala
- El modificador tiene un panel con el recuento de avisos por tipo, ordenados por gravedad (`geometry_nodes_caller_ui.cc:655-715`). Incluye los de los grupos anidados.
- La búsqueda de nodos indexa los avisos con el formato `Tipo: "mensaje" (nodo)` y salta al nodo (`node_select.cc:1430,1450-1520`).
- El cálculo es perezoso y se cachea.

## Cambios de interfaz
- Los sockets se casan por identificador, no por nombre ni posición (`node_socket.cc:218-283`).
- Si cambia el tipo de un socket, sus cables pasan al socket nuevo y quedan inválidos, no borrados.
- Si un socket desaparece, sus cables **se borran** (`node.cc:3981-3987`). Es un fallo que conviene evitar.

## Para Open Gen Studio
- **Copiar:**
  - los tres niveles, con un icono para el más grave y un tooltip multilínea;
  - la validez del cable calculada en una pasada, con el motivo guardado aparte;
  - el cable inválido en rojo con un icono y su motivo;
  - los avisos que suben a grupo y space, con el panel de recuento y la búsqueda por texto de aviso.
- **Diseñar nosotros, porque Blender no lo tiene:**
  - la entrada obligatoria vacía, con el socket en rojo, un icono de prohibido y «Se requiere …»;
  - la distinción entre el origen del fallo y los nodos «bloqueados por otro»;
  - el cable fijado cuyo origen cambió, como aviso en ámbar con dos salidas: usar el valor nuevo o mantener el fijado.
- **Evitar:** borrar cables cuando desaparece un socket. Hay que conservarlos como inválidos, con el motivo «el socket X ya no existe».

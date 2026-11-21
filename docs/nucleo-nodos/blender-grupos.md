# Cómo resuelve Blender los grupos de nodos

Lectura del código fuente de Blender, rama `main` en `adc04d0` (2026-11-21), solo lectura. Leyó Gemini 4 Neon y Sonnet cotejó cada cita contra el código; las líneas que se citan aquí están confirmadas. El código parcial está en `~/Descargas/blender-src-nodos/source/blender/`. Complementa [blender-avisos](blender-avisos.md), que cubre los avisos y los cables inválidos.

## Interfaz del grupo
- La interfaz es una sola declaración, `bNodeTreeInterface`, que guarda paneles y sockets (`BKE_node_tree_interface.hh:42-53`).
- Dentro del grupo, Group Input expone las entradas como salidas y Group Output recoge las salidas como entradas (`node_common.cc:986-1041`). Conectar un cable al socket vacío `__extend__` crea un puerto nuevo (`node_common.cc:1043-1097`).
- El nodo grupo de fuera declara sus sockets a partir de esa interfaz (`node_group_declare`, `node_common.cc:454-554`).
- **Id estable:** cada socket recibe `Socket_N` con un contador que solo crece (`node_tree_interface.cc:495,1287,1867-1890,1948`). Todas las búsquedas casan por ese id, nunca por nombre ni posición (`node_common.cc:75-93`).
- Renombrar, reordenar o cambiar de tipo conserva el id (`node_tree_interface.cc:802-855,1024-1078,2130-2133`). Que el id no cambie al renombrar es una inferencia: el id solo se asigna al crear o copiar.
- **Sincronización en cascada:** al cambiar la interfaz, el actualizador marca cada nodo grupo que la usa y redeclara sus sockets. Recorre los árboles en orden topológico, de hijos a padres (`node_tree_update.cc:475-545,580-605,785-827`).

## Varias salidas
- Cada salida de la interfaz es un socket distinto del nodo grupo, y cada cable de fuera lee exactamente la suya (`geometry_nodes_lazy_function.cc:3077-3088,3119-3123`).
- Puede haber varios Group Output, pero **solo publica el activo**. Los demás muestran el aviso «Unused Output» en la interfaz (`node_common.cc:1176-1191`) y sus resultados se pierden en silencio.
- Sin ningún Group Output, el grupo entrega valores por defecto (`geometry_nodes_lazy_function.cc:2472-2474,2893-2902`).

## Ejecución
- **Geometry nodes, anidado:** los grupos no se aplanan (`NOD_geometry_nodes_lazy_function.hh:15-24`). El grupo es un nodo más del grafo del padre, con su propio contexto de cálculo, y llama a la función del hijo (`geometry_nodes_lazy_function.cc:1138-1262`).
- **Ningún paso intermedio se publica** como resultado del grupo: el grupo solo entrega lo que llega a Group Output (`geometry_nodes_lazy_function.cc:2545-2547,3090-3092`).
- **Los resultados interiores no se guardan.** Viven mientras dura la ejecución y solo se registran para inspección si se pide (`log_socket_value`, `geometry_nodes_lazy_function.cc:1820`). Lo único persistente es Bake o Simulación, por una referencia anidada `{nodo, hijo}` (`NOD_geometry_nodes_lazy_function.hh:128-147`).
- **Shaders:** la función que aplanaba grupos ya no está en este código (`node_shader_tree.cc:135,293` solo la mencionan). No sirve de modelo de frontera.

## Recursión, ciclos y errores
- Un grupo no puede contenerse a sí mismo, ni directa ni indirectamente (`node_group_poll` y `poll_instance`, `node_common.cc:145,176-208`).
- Un cable que cierra un ciclo dentro de un árbol queda inválido (`node_tree_update.cc:1651-1661`).
- La ejecución tiene un límite de 100 niveles de anidación; al pasarlo, avisa con un error en el nodo padre y entrega valores por defecto (`NOD_geometry_nodes_lazy_function.hh:259`, `geometry_nodes_lazy_function.cc:1192-1208`).
- La validez de los cables se recalcula en cada cambio. Si un socket deja de estar disponible, su cable queda inválido (`node_tree_update.cc:1614-1640`). Nada lanza una excepción por un grafo mal formado.

## Para Open Gen Studio
Esto es inferencia, no código de Blender: Blender no tiene frescura, intentos pagados ni assets.
- **Copiar:**
  - una sola declaración de puertos con id estable, que usen igual el cableado, la interfaz, los avisos y el plan;
  - la frontera estricta: solo el nodo Salida publica hacia fuera;
  - los errores como avisos, nunca como excepción;
  - el límite de anidación y el rechazo de un espacio que se contiene a sí mismo.
- **Hacer distinto:** cada nodo interior **conserva su resultado**. En OGS es una generación pagada; en Blender, el equivalente más cercano es Bake.
- **Evitar:**
  - que un segundo nodo Salida pierda resultados en silencio;
  - borrar cables cuando desaparece un puerto: se conservan como inválidos, como ya dice [blender-avisos](blender-avisos.md).

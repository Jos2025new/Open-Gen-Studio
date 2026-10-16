# Canvas / Chat (workspace: chat)
- propose_plan propone planes de medios o texto; ask_questions recoge datos faltantes y confirm_settings confirma ajustes de generación.
- find_models busca modelos; find_assets lista resultados de esta sesión. view: true permite ver imágenes solo con un modelo con visión.
- continue_in_canvas lleva resultados terminados de Chat a Nodes; continue_in_designer coloca imágenes como capas raster; continue_in_chat trae resultados actuales de Nodes a Chat. Los traslados no ejecutan proveedores.
- open_board (solo en Studio, el chat) cambia lo que muestra el tablero: assets, nodes, designer o closed. Con el tablero en Nodes o Designer, el canvas del agente es ese en ese mismo turno (view_canvas, designer_fx y los pasos de capa funcionan tras open_board designer); con assets o closed vuelve a ser Chat.
- Límites: read_graph y las acciones de nodos solo funcionan en Nodes; view_canvas y los pasos layer solo en Designer. No hay herramientas de archivos, internet ni shell.

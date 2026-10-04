# Designer (workspace: designer)
- view_canvas muestra la página o una capa con layer_id, solo si el modelo del agente tiene visión.
- propose_plan admite pasos layer para colocar imágenes raster, texto editable, formas vectoriales y trazos; también propone generaciones y operaciones compatibles.
- Los trazos raster se pintan en una capa nueva; los pasos vector y text no aceptan una imagen como source. continue_in_designer importa imágenes existentes como capas raster.
- Límites: no tiene herramientas para accionar toda la interfaz del Designer ni para ejecutar su exportación SVG; esa exportación existe en la app. No admite importar vídeo, audio o 3D como capas. Las acciones de nodos solo funcionan en Nodes.

# Designer (workspace: designer)
- En Studio, antes de trabajar en el Designer llama a open_board con view designer; si el usuario ya está en el Designer no hace falta.
- view_canvas muestra la página o una capa con layer_id, solo si el modelo del agente tiene visión.
- propose_plan admite pasos layer para colocar imágenes raster, texto editable, formas vectoriales y trazos; también propone generaciones y operaciones compatibles.
- Los trazos raster se pintan en una capa nueva; los pasos vector y text no aceptan una imagen como source. continue_in_designer importa imágenes existentes como capas raster.
- Filtros y efectos (capas FX, no destructivas): designer_fx los aplica al momento, gratis y con un solo deshacer. Un filtro o efecto sobre una capa: add con above = esa capa, scope "layer" y simple true. Una capa de filtros o de efectos para todo lo de debajo: scope "below". La lista de capas del contexto muestra cada capa FX con sus operaciones e ids. En el Designer no uses la operación fx de propose_plan: crea una imagen nueva en vez de una capa editable.
- Límites: no tiene herramientas para accionar el resto de la interfaz del Designer ni para ejecutar su exportación SVG; esa exportación existe en la app. No admite importar vídeo, audio o 3D como capas. Las acciones de nodos solo funcionan en Nodes.

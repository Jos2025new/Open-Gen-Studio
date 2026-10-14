# Continuidad y dirección de video

Las propuestas nuevas del agente deben declarar la fuente y todos los consumidores cuando un sujeto nombrado con `@Nombre` reaparece en varios pasos de imagen o video. Se comprueban las conexiones reales; mencionar una fuente o compartir texto no sustituye sus entradas. La normalización de planes anteriores conserva la compatibilidad. Esta comprobación reconoce sujetos declarados o de la biblioteca, no identifica personajes por prosa libre.

El bloque de estilo común se aplica literalmente al prompt de cada paso y a cada prompt estructurado de shot. Se mantienen los formatos y límites del modelo confirmado. Las referencias dentro de shots también deben llegar al flujo de transporte de sujetos.

Las menciones de cada shot se convierten a la sintaxis del proveedor manteniendo los índices de los sujetos para todo el clip. El esquema debe permitir el transporte de una referencia implícita; si no lo permite, solo una entrada explícita compatible puede establecer la conexión. Una vista secundaria de biblioteca también necesita una conexión explícita para no asumir que el runner la envía.

Todos los modos reciben instrucciones comunes sobre roles y atributos heredados o excluidos, estado inicial, contacto, respuesta y estado final. La física respeta el medio solicitado: 2D, 3D estilizado o realista. La guía de dirección amplía orientación, encuadre, perspectiva, cámara y transiciones, sin imponer grano, óptica fotográfica o formato panorámico. Personajes, arquitectura, productos y anuncios reutilizan estas reglas con sus fuentes y propiedades pertinentes.

Un beat no implica un corte. Una transición pedida dentro de un clip y un montaje entre clips son operaciones distintas; solo se usan entradas y operaciones disponibles. Los cambios intencionales de propiedades se excluyen de lo que debe preservarse.

## Evidencia y límites

Los tests de contratos cubren validación, transporte declarado, aplicación del estilo y llegada de instrucciones al contexto. No demuestran que el generador respete identidad, geometría, física o transiciones. No hay análisis automático de video, nuevas llamadas al modelo ni generaciones preparatorias obligatorias.

La revisión visual queda a cargo del usuario: comparar identidad y estilo entre shots, contacto y estados de objetos, continuidad del eje y la dirección, y separación entre cortes solicitados y accidentales. Registrar el momento, el atributo y el defecto permite distinguir un problema de planificación de un resultado que ignoró entradas correctas.

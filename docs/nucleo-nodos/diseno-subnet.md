# Diseño: el espacio como subnet

Carril delicado (2026-11-21, sesión maestra 5). Documento de criterios antes de escribir código. Fuentes: tus decisiones del 17 al 19 de noviembre, el [ADR 0031](../decisions/0031-nucleo-de-nodos.md), [blender-grupos](blender-grupos.md), [blender-avisos](blender-avisos.md) y la revisión de GPT de `task/descriptor-2` (bus `20261121-gpt-ataca-descriptor-2b.md`).

## Ya decidido: no se vuelve a preguntar
- **Tus decisiones:**
  - un espacio tiene un inicio y un fin, y es un nodo (2026-11-18);
  - los componentes se envuelven sin cambiar nada de lo que existe (2026-11-18);
  - los nodos de sistema solo se ven en el omnicanvas (2026-11-17, repetido el 11-19).
- **Propuestas técnicas, que este documento adopta:**
  - convertir el espacio en un plan plano para el ejecutor de hoy ([ADR 0031](../decisions/0031-nucleo-de-nodos.md), punto «Space»);
  - el orden: primero el envoltorio, después el subnet.
  - Las dos vinieron de los modelos y no las objetaste.

## Modelo
1. **Un espacio es un nodo con un grafo dentro.** Dentro tiene un nodo Entrada y un nodo Salida, que son tu inicio y tu fin. Desde fuera se ve como una tarjeta con sus puertos.
2. **Una sola declaración de puertos.** Los puertos del espacio salen de Entrada y Salida, cada uno con un id estable que no cambia al renombrar, reordenar ni cambiar de tipo. El cableado, la tarjeta, los avisos, la validación y el plan leen todos esa misma declaración, como `bNodeTreeInterface` en Blender.
3. **Frontera estricta.** Hacia fuera solo publica el nodo Salida. Una salida del espacio es una referencia a lo que llega a su puerto de Salida, que se resuelve al leer: nunca se copia ni se escribe en el espacio.
4. **Cada nodo interior es un nodo de verdad.** Guarda su propio resultado, sus intentos, su coste y su frescura, igual que hoy un nodo del lienzo. En OGS cada resultado es una generación pagada, así que se conserva siempre (en Blender, el equivalente más cercano es Bake).
5. **Ejecución por plan plano.** Antes de planificar, el espacio se expande: cada nodo interior aporta su paso con su propia identidad (espacio y nodo interior). El ejecutor, los envíos durables y la recuperación tras recargar trabajan como hoy, nodo a nodo. Ningún paso escribe en el nodo del espacio.
6. **Mismo lote.** Si el productor de una salida se ejecuta en el mismo lote, el consumidor espera su resultado nuevo. Nunca lee el anterior.
7. **Errores como avisos.** Un grafo mal formado nunca lanza una excepción en el render ni al cargar. Se ven como avisos que suben al espacio, como en [blender-avisos](blender-avisos.md).
8. **Límites.** Un espacio no puede contenerse a sí mismo, ni directa ni indirectamente. Los ciclos se validan a través de la frontera. La anidación tiene un límite y, al pasarlo, avisa.

## Ciclo de vida de un puerto
| Cambio | Qué pasa con los cables |
|---|---|
| Añadir | El puerto aparece en la tarjeta; ningún cable cambia |
| Renombrar o reordenar | Mismo id: los cables siguen igual |
| Cambiar de tipo | Los cables se conservan; los incompatibles quedan inválidos con su motivo |
| Quitar | Los cables se conservan como inválidos, con «el puerto X ya no existe»; nunca se reconectan a otra salida |
| Nombre reservado (`out`, `out-N`, `out-gone`) | No puede existir: los ids de puerto se generan, así que no chocan |
| Un segundo nodo Salida | Aviso visible; no se pierden resultados en silencio |

## Criterios de aceptación
Cada criterio es un test que falla antes del arreglo.
- **Consumidor real:** un espacio con dos salidas, una de texto y otra de imagen, conectado a dos nodos de fuera.
- **Ida y vuelta:** crear, conectar, guardar, recargar, resolver y planificar dan lo mismo antes y después de recargar.
- **Ciclo de vida:** cada fila de la tabla anterior.
- **Los cinco fallos de la revisión de GPT**, que no pueden repetirse:
  1. una declaración inválida no tumba el lienzo;
  2. un paso intermedio nunca se publica como resultado;
  3. recargar entre pasos conserva cada intento en su nodo interior, sin reenviar ni cobrar dos veces;
  4. el consumidor del mismo lote recibe el resultado nuevo de la salida correcta;
  5. el lienzo, los avisos y el plan ven los mismos puertos.
- **Equivalencia:** los nodos y cables de hoy se comportan igual, también en coste, aprobación y frescura.

## Qué pasa con `task/descriptor-2`
- **Se conserva:**
  - los valores iniciales por tipo y `DefaultsEnv`;
  - el verificador endurecido;
  - el contexto de puertos (`env`);
  - el guardado del handle al conectar y que un handle retirado no caiga en `out`;
  - la frescura por tipo y el registro de interfaz por tipo.
- **Se sustituye:** el plan de varios pasos que escribe en el nodo dueño (`ownerNodeId`, commit `f51e21b4`). Contradice el punto 5: con nodos interiores reales, cada paso es de su propio nodo.
- **Se arregla antes de fusionar:** el fallo 1, que el lienzo no se caiga.

## Plan
1. **Prueba de dos arquitecturas, medida y corta:**
   - (a) expandir a plan plano con identidad por nodo interior;
   - (b) ejecutar anidado, como geometry nodes.
   - Se mide qué reutiliza de ejecutor, envíos durables, recuperación y frescura, y cuánto código nuevo exige. Recomendación previa: (a), porque reutiliza todo lo que ya protege el dinero.
2. Una declaración de puertos y los nodos Entrada y Salida, con su ciclo de vida.
3. La expansión y la ejecución, con el consumidor real.
4. Envolver los componentes uno a uno con la misma receta (ADR 0031, tira 4).

Cada paso lo ataca un revisor en su propia carpeta. No se encadena el siguiente sin un «fusionable sí».

## Pendiente de tu aprobación, cuando llegue
- **Formato guardado:** si el grafo interior añade campos o una versión al JSON, hace falta tu autorización explícita ([ADR 0031](../decisions/0031-nucleo-de-nodos.md), consecuencias).
- **Interfaz:**
  - cómo se ven y se editan los puertos de un espacio;
  - cómo se abre un espacio por dentro;
  - dónde aparece «desactualizado».

  Toca la identidad visual, así que va con boceto (AGENTS.md, regla 6).
- **Compatibilidad:** propuesta de Neon sin confirmar: la salida `out` actual de los espacios queda como respaldo mientras no haya nodo Salida.
- **Alcance:** ¿Create y Tools serán también subnets, o solo Studio, Nodes y Designer?

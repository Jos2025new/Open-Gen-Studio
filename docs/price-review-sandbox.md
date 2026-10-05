# Revisión de precio en sandbox, sin proveedor

Esta receta inicia una revisión sintética de USD 0.20 a USD 1.20 y usa los botones
reales de la app. Simula generación y respuesta del agente; no demuestra qué
redactaría un modelo real. No usa credenciales válidas. No cambia código de la app.

Código del comportamiento: [PlanCard.tsx](../src/components/chat/PlanCard.tsx),
[runtime.ts](../src/engine/agent/runtime.ts), [priceNotes.ts](../src/engine/agent/priceNotes.ts).
Tests con proveedores simulados: [price-agent-notes.test.ts](../tests/price-agent-notes.test.ts)
y [price-approval.test.ts](../tests/journeys/price-approval.test.ts). El segundo
cubre el aumento detectado antes del envío; esta receta empieza con la revisión
ya preparada, por lo que no reproduce la selección natural de una variante.

## Arranque aislado

El lanzador npm run dev:sandbox actual copia data/ hacia el sandbox antes de
arrancar. Para esta prueba, que prohíbe leer data/, usa Vite directamente y una
carpeta nueva dentro de .sandbox/data, sin cambiar el lanzador ni borrar nada:

```bash
cd '/home/samuel/Documentos/Projects/My New App/ogs-price-auth'
mkdir -p .sandbox/data
PRICE_REVIEW_DATA=$(mktemp -d "$PWD/.sandbox/data/price-review-XXXXXX")
DATA_DIR="$PRICE_REVIEW_DATA" node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5183 --strictPort
```

Si el puerto está ocupado, no cierres el proceso ajeno. Abre una ventana privada
nueva en http://127.0.0.1:5183, para que no herede IndexedDB de una sesión previa.
No importes sesiones ni claves y no abras la app real. Espera a ver la interfaz.

## Preparar la tarjeta sintética

Abre las herramientas de desarrollo del navegador, pestaña Console, y ejecuta el
bloque siguiente una vez. El fetch simulado intercepta el chat y bloquea cualquier
otro fetch externo o relay; únicamente permite /x/store/ del sandbox local.
La generación devuelve una imagen local y USD 0.73 ficticios. Los datos de esta
prueba permanecen exclusivamente en la carpeta nueva y la ventana privada.
No recargues la página durante la prueba: la interceptación vive en memoria.

```javascript
if (location.origin !== 'http://127.0.0.1:5183') throw Error('Solo sandbox 5183');
if (window.priceReviewDemo) throw Error('Demo ya instalada');
const originalFetch = window.fetch.bind(window);
const demo = { bodies: [], mediaCalls: 0 };
window.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/x/store/')) {
    return originalFetch(input, init);
  }
  if (url.href === 'https://nano-gpt.com/api/v1/chat/completions') {
    const body = JSON.parse(String(init?.body));
    demo.bodies.push(body);
    const notes = body.messages.filter(m => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[app]')).map(m => m.content).join('\n');
    const text = notes.includes('Decisión: Cancelar.')
      ? 'Simulación: cancelaste el paso. No se envió y no lo reintentaré.'
      : notes.includes('coste informado por el proveedor: $0.73')
        ? 'Simulación: autorizaste $1.20 estimados; el paso terminó. El proveedor simulado informó $0.73.'
        : 'Simulación: recibí el contexto de la app.';
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  }
  throw Error('Red externa bloqueada en la demo');
};
const { useStore, newSession } = await import('/src/store/store.ts');
const { createGeneration } = await import('/src/engine/jobs.ts');
const { costAuthorization } = await import('/src/engine/priceAuthorization.ts');
const { ADAPTERS } = await import('/src/engine/providers/registry.ts');
const ref = 'nanogpt::test-image';
ADAPTERS.nanogpt.generate = async () => {
  demo.mediaCalls++;
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1kAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  return { outputs: [{ blob: new Blob([bytes], { type: 'image/png' }), mime: 'image/png' }], costUsd: 0.73 };
};
demo.prepare = () => {
  const sid = newSession();
  const st = useStore.getState();
  useStore.setState({
    settings: { ...st.settings, budgetOn: false, keys: { openrouter: '', fal: '', atlas: '', nanogpt: 'test-only' }, agent: { ...st.settings.agent, provider: 'nanogpt', model: 'test-luna', effort: 'low' } },
    ui: { ...st.ui, workspace: 'chat' },
    catalog: { ...st.catalog, models: { ...st.catalog.models, [ref]: { ref, provider: 'nanogpt', id: 'test-image', name: 'Test', kind: 'image', acceptsText: true, acceptsImage: false, tags: [], price: { skus: [{ unit: 'output', usd: 1.2 }] } } }, schemas: { ...st.catalog.schemas, [ref]: { ref, params: [], slots: { prompt: 'prompt', promptRequired: true }, source: 'catalog' } } },
  });
  const settings = { count: 1, resolution: 'new', advanced: {} };
  const g = createGeneration({ sessionId: sid, origin: 'agent', kind: 'image', prompt: 'test', modelRef: ref, settings, inputs: { refs: [] }, planId: 'P', stepId: 's1' });
  const approved = costAuthorization(ref, { ...settings, resolution: 'old' }, { usd: 0.2, approximate: true });
  const proposed = costAuthorization(ref, settings, { usd: 1.2, approximate: true });
  const item = { id: 'card', workspace: 'chat', createdAt: Date.now(), type: 'plan', style: 'guided', status: 'review', plan: { id: 'P', title: 'Prueba de precio', summary: 'Simulación sin gasto', workspace: 'chat', steps: [{ id: 's1', title: 'Imagen simulada', kind: 'image', prompt: 'test', modelRef: ref, settings, refs: [] }], adjustments: [] }, stepStates: { s1: 'review' }, stepGenerations: { s1: g.id }, stepAuthorizations: { s1: approved }, stepCostReviews: { s1: { approved, proposed, reason: 'cambiaron los parámetros', message: 'Este paso costaría $1.20 en vez de $0.20 aprobados (simulación).' } }, estimate: proposed.estimate };
  useStore.setState(s => ({ generations: { ...s.generations, [g.id]: { ...g, status: 'review' } }, sessions: { ...s.sessions, [sid]: { ...s.sessions[sid], feed: [item] } } }));
  demo.sid = sid;
  demo.gid = g.id;
  demo.bodies = [];
  demo.mediaCalls = 0;
};
window.priceReviewDemo = demo;
demo.prepare();
```

## Continuar y Cancelar

1. En la tarjeta, pulsa **Continuar** y espera a que termine la imagen simulada.
   El resumen simulado debe distinguir USD 1.20 autorizados de USD 0.73 informados
   por el proveedor simulado. No debe afirmar que se cobraron USD 1.20.
2. En Console, consulta `priceReviewDemo.mediaCalls`: debe ser 1. Consulta
   `priceReviewDemo.bodies.at(-1).messages`: el contexto debe contener una sola nota
   de decisión Continuar (pendiente) y otra nota de resultado terminado con $0.73.
   Son mensajes aparte; la nota de autorización no se reescribe.
3. En Console, ejecuta `priceReviewDemo.prepare()` para crear otra sesión sintética.
   Pulsa **Cancelar paso**. El agente simulado debe decir que no se envió y no se
   reintentará. `priceReviewDemo.mediaCalls` debe ser 0; en el contexto debe estar
   `Decisión: Cancelar. No enviado. No reintentar.` una sola vez.
4. Cierra la ventana privada y detén únicamente tu servidor con Ctrl+C. No borres
   los datos ni los locks del piloto. No ejecutes scripts de proveedor.

Una respuesta de un agente real debería expresar lo mismo, sin exigir redacción
literal. Si el proveedor no informa coste, debe decir «coste real desconocido»;
si la generación falla, debe comunicar fallo. Mientras siga pendiente, no debe
anunciarla terminada ni presentar la autorización como cobro. Las notas se entregan
en la siguiente llamada existente; no despiertan al agente por sí mismas.

Verificación visual de esta receta: pendiente de ejecución manual del usuario.
Los tests existentes sí comprueban contexto enviado, decisión, coste informado,
recarga, cancelación bloqueada y continuaciones, con proveedores simulados.

```bash
npm test -- --maxWorkers=2 tests/price-agent-notes.test.ts tests/journeys/price-approval.test.ts
```

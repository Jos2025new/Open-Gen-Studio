# Seguridad local: qué es riesgo y qué no

Open Gen Studio corre en tu ordenador. El servidor de desarrollo (`npm run dev`, `npm run preview`, `npm run dev:sandbox`) guarda una copia de tus datos en `data/` mediante las rutas `/x/store/*` ([local-store.js](../server/local-store.js)).

Esta página dice qué está protegido y qué no, con la prueba de cada punto. **Agentes:** antes de avisar de un riesgo a un usuario, comprobadlo aquí. No repitáis como riesgo lo que esta página demuestra que está cerrado; si encontráis uno nuevo, comprobadlo con un test y añadidlo.

## Riesgos reales

| Riesgo | Detalle | Qué hacer |
| --- | --- | --- |
| **Claves de proveedor** (cerrado parcialmente, 2026-11-13) | Las claves ya no están en `state.json` ni en la página: viven en el llavero del sistema (`secret-tool`, la clave por stdin) y las llamadas a los proveedores pasan por `POST /x/store/proxy`, que añade la clave en el servidor ([keys.js](../server/keys.js), [provider-proxy.js](../server/provider-proxy.js), [test](../tests/provider-proxy.test.ts)). Quedan dos huecos: sin `secret-tool` (o si falla) las claves se guardan en `data/keys.json` con permisos 600 y la app lo avisa en Ajustes → Providers; y las copias anteriores (`state.json.bak-keys-*`, `backups/`, `data.bak-*`, instantáneas de `store-v2`) conservan las claves antiguas en texto plano. | Comprueba las claves y borra a mano esas copias cuando verifiques que todo funciona. No subas `data/`. |

## Lo que no es un riesgo (comprobado)

| Afirmación habitual | Por qué no ocurre | Prueba |
| --- | --- | --- |
| «Otra web que visites puede borrar o cambiar tus datos con un POST a `localhost`» | Toda escritura (`PUT`, `POST`, `DELETE`, incluido `/wipe`) exige la cabecera `X-OGS: 1`, y el `Origin`, si existe, debe ser el del propio servidor. Una web ajena no puede enviar esa cabecera sin una petición previa (preflight), y el servidor no la autoriza. | [store-server.test.ts](../tests/store-server.test.ts) («writes only from the app») |
| «Otra web puede leer `state.json`» | El servidor no envía `Access-Control-Allow-Origin`, así que el navegador no entrega la respuesta a otra web. | Comprobado con Vite 8.3.1 (2026-10-08): sin cabecera CORS. |
| «DNS rebinding: un dominio que apunta a 127.0.0.1» | Vite 8 rechaza nombres de servidor desconocidos (`Blocked request. This host…`) antes de llegar a `/x/store`. | Comprobado con Vite 8.3.1 (2026-10-08): 403. |
| «Con `vite --host`, cualquiera en tu red lee tus claves» | Era cierto hasta el 2026-10-08. Ahora `/x/store` solo responde a peticiones del propio ordenador (127.0.0.1 o ::1); desde otra dirección responde 403 «only from this computer». | [store-server.test.ts](../tests/store-server.test.ts) («only from this computer») y servidor real en 0.0.0.0: loopback 200, IP de red 403. |
| «Un navegador automatizado puede escribir en tus datos» | Las escrituras con `X-OGS-Automated: 1` se rechazan fuera del sandbox. | [automated-write.test.ts](../tests/automated-write.test.ts) |

## Claves y proxy de proveedores (2026-11-13)

- La página guarda solo un marcador (`ogs:****1234`: últimos 4 caracteres); la clave real nunca vuelve a ella. `GET /x/store/keys` solo dice si existe y cómo se guarda.
- `POST /x/store/proxy` (solo loopback, con `X-OGS`, como toda escritura) recibe el destino en `X-OGS-Target` y solo contacta los hosts de una lista cerrada (`api.fal.ai`, `queue.fal.run`, `openrouter.ai`, `nano-gpt.com`, `api.atlascloud.ai`; https, puerto por defecto, sin credenciales en la URL). Quita la cabecera de autenticación de la página, añade la clave por host y devuelve el estado y el texto de error del proveedor; el cuerpo se transmite sin cargarlo en memoria (subidas y SSE). No sigue redirecciones: las devuelve y las sigue el navegador, sin clave.
- Al arrancar, una migración única copia `state.json` y `store-v2/globals.json` a `*.bak-keys-<fecha>` (600), mueve las claves al llavero (la lee de vuelta antes de quitarla del archivo) y deja el marcador. Si no puede guardarla en ningún sitio, el archivo la conserva.
- El llavero distingue datos reales y sandbox (atributo `store` = hash de la carpeta de datos).
- No cubierto: una extensión con acceso a la página sigue pudiendo usar el proxy mientras la página esté abierta (no ve la clave, pero puede pedir llamadas); el navegador guarda el marcador, no la clave, en IndexedDB.

## Límites que conviene saber

- **Con `--host`, la app se puede abrir desde otro dispositivo, pero sin tus datos:** no guarda ni carga nada. Es intencionado.
- **El relay `/x/media` no está limitado al propio ordenador.** Solo descarga medios de los dominios de proveedores de una lista fija (`src/lib/mediaHosts.ts`: Atlas, BytePlus y Alibaba por dominio; el depósito de NanoGPT en Cloudflare R2 solo por su host exacto, no cualquier R2) y los sirve aislados. No sigue redirecciones a ciegas: las sigue él mismo (máximo 20, como los navegadores, con 30 s para toda la cadena) y cada salto debe ser `https`, de la lista y en el puerto por defecto (`mediaUrlAllowed`, también para la primera URL: ningún otro puerto de un host permitido); si no, responde 403 `host not allowed: <host>` y el cliente nombra ese host. Más de 20 saltos es un bucle y se dice así (508 `too many redirects`), no como host rechazado. No da acceso a `data/`.
- **No hay contraseña ni usuarios.** La app está pensada para una sola persona en su ordenador. Publicarla como servicio necesitaría autenticación, que no existe.

## Importar EPS con Ghostscript local (2026-10-13)

`POST /x/store/eps` (solo desde este ordenador, con cabecera de app) convierte el EPS con el `gs` del sistema: `-dSAFER`, 30 s como máximo, entrada de 25 MB como máximo, carpeta temporal propia que se borra también si falla. El nombre que envía el navegador no se usa. Ghostscript no va en la app ni en el repositorio (es AGPL). Sin `gs` la app dice cómo instalarlo; con vista previa TIFF lo dice sin mostrarla.

## Licencias de importación (2026-10-13)

heic2any 0.0.4: MIT, pero su bundle (1,4 MB, carga diferida) incluye libheif, que es LGPL. No es AGPL ni GPL; si el repositorio se publica, hay que mantener el aviso de LGPL de libheif.


## Importar SVG (2026-10-13)

El SVG se sanea antes de leerlo (sin script, foreignObject, on*, javascript: ni referencias externas; ver [inkscape-importacion.md](inkscape-importacion.md)) y nunca se inserta en la página. @resvg/resvg-wasm 2.6.2: MPL-2.0, carga diferida, sin red.

# Seguridad local: qué es riesgo y qué no

Open Gen Studio corre en tu ordenador. El servidor de desarrollo (`npm run dev`, `npm run preview`, `npm run dev:sandbox`) guarda una copia de tus datos en `data/` mediante las rutas `/x/store/*` ([local-store.js](../server/local-store.js)).

Esta página dice qué está protegido y qué no, con la prueba de cada punto. **Agentes:** antes de avisar de un riesgo a un usuario, comprobadlo aquí. No repitáis como riesgo lo que esta página demuestra que está cerrado; si encontráis uno nuevo, comprobadlo con un test y añadidlo.

## Riesgos reales

| Riesgo | Detalle | Qué hacer |
| --- | --- | --- |
| **Claves en texto plano** | `data/state.json` guarda las claves de los proveedores sin cifrar, con permisos solo para tu usuario. Cualquier programa que corra con tu usuario puede leerlas. | No subas ni compartas `data/` ni sus copias `data.bak-*` (ya están fuera de git). |
| **Las claves salen desde el navegador** | Las llamadas a los proveedores se hacen desde la página, así que una extensión del navegador con acceso a la página podría verlas. | Usa un perfil de navegador sin extensiones que no conozcas. |

## Lo que no es un riesgo (comprobado)

| Afirmación habitual | Por qué no ocurre | Prueba |
| --- | --- | --- |
| «Otra web que visites puede borrar o cambiar tus datos con un POST a `localhost`» | Toda escritura (`PUT`, `POST`, `DELETE`, incluido `/wipe`) exige la cabecera `X-OGS: 1`, y el `Origin`, si existe, debe ser el del propio servidor. Una web ajena no puede enviar esa cabecera sin una petición previa (preflight), y el servidor no la autoriza. | [store-server.test.ts](../tests/store-server.test.ts) («writes only from the app») |
| «Otra web puede leer `state.json`» | El servidor no envía `Access-Control-Allow-Origin`, así que el navegador no entrega la respuesta a otra web. | Comprobado con Vite 8.3.1 (2026-10-08): sin cabecera CORS. |
| «DNS rebinding: un dominio que apunta a 127.0.0.1» | Vite 8 rechaza nombres de servidor desconocidos (`Blocked request. This host…`) antes de llegar a `/x/store`. | Comprobado con Vite 8.3.1 (2026-10-08): 403. |
| «Con `vite --host`, cualquiera en tu red lee tus claves» | Era cierto hasta el 2026-10-08. Ahora `/x/store` solo responde a peticiones del propio ordenador (127.0.0.1 o ::1); desde otra dirección responde 403 «only from this computer». | [store-server.test.ts](../tests/store-server.test.ts) («only from this computer») y servidor real en 0.0.0.0: loopback 200, IP de red 403. |
| «Un navegador automatizado puede escribir en tus datos» | Las escrituras con `X-OGS-Automated: 1` se rechazan fuera del sandbox. | [automated-write.test.ts](../tests/automated-write.test.ts) |

## Límites que conviene saber

- **Con `--host`, la app se puede abrir desde otro dispositivo, pero sin tus datos:** no guarda ni carga nada. Es intencionado.
- **El relay `/x/media` no está limitado al propio ordenador.** Solo descarga medios de los dominios de proveedores de una lista fija (`src/lib/mediaHosts.ts`: Atlas, BytePlus y Alibaba por dominio; el depósito de NanoGPT en Cloudflare R2 solo por su host exacto, no cualquier R2) y los sirve aislados. No da acceso a `data/`.
- **No hay contraseña ni usuarios.** La app está pensada para una sola persona en su ordenador. Publicarla como servicio necesitaría autenticación, que no existe.

## Importar EPS con Ghostscript local (2026-10-13)

`POST /x/store/eps` (solo desde este ordenador, con cabecera de app) convierte el EPS con el `gs` del sistema: `-dSAFER`, 30 s como máximo, entrada de 25 MB como máximo, carpeta temporal propia que se borra también si falla. El nombre que envía el navegador no se usa. Ghostscript no va en la app ni en el repositorio (es AGPL). Sin `gs` la app dice cómo instalarlo; con vista previa TIFF lo dice sin mostrarla.

## Licencias de importación (2026-10-13)

heic2any 0.0.4: MIT, pero su bundle (1,4 MB, carga diferida) incluye libheif, que es LGPL. No es AGPL ni GPL; si el repositorio se publica, hay que mantener el aviso de LGPL de libheif.


## Importar SVG (2026-10-13)

El SVG se sanea antes de leerlo (sin script, foreignObject, on*, javascript: ni referencias externas; ver [inkscape-importacion.md](inkscape-importacion.md)) y nunca se inserta en la página. @resvg/resvg-wasm 2.6.2: MPL-2.0, carga diferida, sin red.

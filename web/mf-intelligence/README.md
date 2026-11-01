# MF04 Inteligencia

Tecnología: React 19 + Vite 8 + Ant Design 6, integrado como microfrontend single-spa en el Shell
(sombra cerrada para estilos y portales, igual que `mf-finance`).

Persistencia: los análisis viven en MongoDB, propiedad de MS04 Inteligencia (CU23). Este
microfrontend nunca habla con el REST empresarial: consume GraphQL a través del BFF con
`SessionPort.requestBusiness`.

Alcance: análisis visual de las evidencias de ejecución (CU16) y consulta de resultados
persistidos, con el aviso explícito de que la salida es una **señal para revisión humana**.

## Pantalla

`/intelligence` — el actor ve los trabajos con evidencia de los últimos 30 días, elige uno, ve sus
evidencias `available` y las analiza. El panel muestra las etiquetas con puntaje y umbral, la
versión del modelo y el historial del trabajo; si el artefacto no está cargado, la pantalla declara
`MODEL_NOT_READY` y no ofrece analizar. La visibilidad depende de `intelligence:read`; la acción de
analizar requiere `intelligence:analyze` y un trabajo a su alcance.

## Comandos comprobados

```sh
cd web/mf-intelligence
pnpm install
pnpm test                 # 6 pruebas del contrato y de los ayudantes de presentación
pnpm run build:integrated # dist/integrated/main.js para el Shell
pnpm dev                  # 127.0.0.1:4205 (modo autónomo con PKCE)
```

En la raíz, `web/shell/scripts/stage-mfs.mjs` copia `dist/integrated/` a `public/mfs/intelligence/`;
`infra/local/docker/web.Dockerfile` construye y verifica ese artefacto dentro de la imagen web.

## Límites

- No sube, descarga ni muestra imágenes: sólo envía `assignmentId` + `evidenceId` al BFF, y MS04
  obtiene los bytes con la URL prefirmada que Operaciones emite para ese actor.
- No hay análisis por lote ni por vídeo, ni detección de personas o matrículas.
- El modelo reconoce sólo las etiquetas de su manifiesto ([`contracts/ai/vision-model.md`](../../contracts/ai/vision-model.md)).

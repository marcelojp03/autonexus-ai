# AutoNexus MCP de consulta

Proceso TypeScript independiente de los agentes internos. Solo seis herramientas GET sobre
órdenes, agenda y metadatos de avances; sin base de negocio, SQL, archivos, precios ni acciones
de CU30. Contrato: `contracts/mcp/consultation.md`, desde la raíz.

## Estado de este incremento

Proyecto inicializado con `npm init -y` sin sobrescribir AGENTS/README; instalación con
`pnpm install --ignore-scripts`, exit 0, creó lockfile. Compilación central con Node22.22.3 y
`node node_modules/typescript/bin/tsc -p tsconfig.json`, exit 0. Las pruebas de componente
están en verificación. No se acredita todavía integración real Keycloak/Operaciones,
registro operativo de clientes, ejecución n8n ni publicación de este incremento.

Herramientas fijadas: Node22.22.3, pnpm12.6.0, TypeScript6.0.3. SDK oficial v2 server/client2.4.0,
node2.1.2, express2.0.2; Express5.2.1, Zod4.6.7 y jose6.2.13. El README oficial actual usa
paquetes divididos; los imports del antiguo SDKv1 no son la API de este proyecto.

## Autorización y configuración

HTTP stateless, bind local127.0.0.1:3006. El token debe tener issuer exacto, RS256, sub/azp/exp
y tipo Bearer, con audiencia propia `[recursoCanónico, autonexus-mcp-server]`. No se acepta
un token destinado a las APIs. El segundo alias pertenece al mismo MCP y habilita el exchange
standard de Keycloak. El token MCP se envía solo al AS confiable para obtener otro token de
Operaciones+Empleados con mismo sub; nunca se reenvía directamente al owner. Sin refresh token
de exchange ni caché/persistencia de tokens. El owner conserva acción/registro y vínculo activo.

`examples/clients.json` muestra una política local con clientes deshabilitados. El registro real
se lee por petición y por exchange, y el catálogo se limita a sus scopes. No es el CRUD web CU31.
`examples/idp-client.json` es solo un formato sin secreto real; no sirve como credencial.

Usar `.env.example` para valores públicos y rutas absolutas privadas. No copiar credenciales al
repositorio, workflow n8n, navegador o logs. El archivo del cliente confidencial pertenece solo
a MCP. En POSIX se rechazan permisos compartidos; las ACL Windows deben protegerse por el
operador. HTTP interno no loopback solo se admite con bandera explícita de desarrollo;
producción exige URLs públicas HTTPS. No se expone por defecto una interfaz pública.

## Comandos

Desde esta carpeta, con las herramientas fijadas, una vez disponibles los archivos privados:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
node --env-file=/ruta/privada/mcp.env dist/main.js
```

Son los comandos del proyecto; un build o una prueba con doubles no valida la integración.
Durante esta verificación se usan ejecutables absolutos y workers con .log/.exit, porque el
shim pnpm local y los límites cortos del lanzador fallaron en intentos previos. No se cambiaron
las herramientas globales.

Las pruebas Node marcan fixtures RSA/IdP/owner controlados como unitarios o de componente.
El cliente oficial SDK prueba HTTP/descubrimiento/invocación, no reemplaza el recorrido real.
El directorio `dist` y todos los datos/secretos de ejecución quedan fuera de Git.

## Límites y auditoría

Claves de entrada cerradas, IDs/fechas/rangos/paginación limitados. Respuestas de propietario
acotadas a512KiB; salida MCP hasta64KiB. Ejecución se pagina localmente desde el agregado
limitado porque el owner no ofrece paginación de avances; si excede el límite se devuelve error.
No se inventa una lista vacía por403/404/503. Órdenes son globales por permiso, no “propias”.

Audit JSONL con actor/cliente/herramienta/correlationId/código/tiempo, sin argumentos, tokens
o cuerpos. Herramientas read-only tienen anotaciones, pero la autoridad se aplica en servidor
y owner; las anotaciones no son un control de seguridad. No se considera validado ni desplegado
en producción por esta base. n8n funciona separado y no necesita este proceso para sus lecturas.


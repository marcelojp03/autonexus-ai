# AutoNexus MCP

Proceso TypeScript independiente de los agentes internos. Expone consultas autorizadas y, cuando
se configura la aserción privada hacia Operaciones, permite solicitar una cita para revisión
humana. La solicitud no crea una cita ni reserva disponibilidad. Contrato: `contracts/mcp/consultation.md`.

## Estado de este incremento

CU29 conserva la evidencia histórica de Keycloak/Operaciones en `docs/evidence/cu29-20261105.md`.
El CRUD MCP usa token privado BFF→MCP y archivo MCP-owned con atomic rename y serialización
intra-proceso. Requiere volumen persistente y una sola instancia; no es un registro multi-replica.
El BFF y la UI no pueden administrar si falta su token privado.

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
se lee por petición y por exchange; la administración revalida el scope allowlist y no persiste
client secrets ni tokens. CU31 requiere configurar fuera del repositorio `MCP_ADMIN_API_TOKEN`
en MCP y los mismos `MCP_ADMIN_URL`/`MCP_ADMIN_TOKEN` en BFF. El acceso a la pantalla y sus campos
GraphQL se autorizan además por `mcp-clients:manage` efectivo.
`examples/idp-client.json` es solo un formato sin secreto real; no sirve como credencial.

Usar variables de entorno desplegadas o archivos privados fuera del repositorio. No copiar credenciales al
repositorio, workflow n8n, navegador o logs. El archivo del cliente confidencial pertenece solo
a MCP. En POSIX se rechazan permisos compartidos; las ACL Windows deben protegerse por el
operador. HTTP interno no loopback solo se admite con bandera explícita de desarrollo;
producción exige URLs públicas HTTPS. Admin requiere el host interno permitido explícitamente
con `MCP_ADMIN_ALLOWED_HOST`. Solicitar cita exige el mismo secreto interno aleatorio
`MCP_OWNER_ASSERTION_SECRET` en MCP y `MCP_CLIENT_ASSERTION_SECRET` en Operaciones; con él, MCP
firma el vínculo entre `operationId`, subject y clientId externo. Este secreto de servicio no es
el client secret OAuth de ChatGPT. Sin esa configuración, el tool de escritura no se anuncia.

## Conectar ChatGPT

La configuración pública del servicio, si se publicó explícitamente con `MCP_PUBLIC_URL`, indica
el endpoint exacto y la URL de Protected Resource Metadata. Sin esa configuración se informa
“no configurado”; nunca se deriva la dirección desde el navegador. Un endpoint loopback o privado
no es alcanzable por ChatGPT en la nube. Para usar una app MCP personalizada se necesita un
endpoint HTTPS público estable (o túnel seguro admitido) y OAuth desplegado y compatible.

1. Publicar `/mcp` detrás de HTTPS estable o un túnel seguro aprobado.
2. Crear en Keycloak un cliente OAuth estático para ChatGPT con la URI de redirección exacta que
   ChatGPT muestre. La configuración de cliente dinámico no se presupone.
3. Registrar en AutoNexus el client ID público y solo los scopes mínimos habilitados.
4. En ChatGPT, crear una app MCP personalizada, ingresar la URL `/mcp`, elegir OAuth y completar
   inicio de sesión y consentimiento.
5. Revisá las herramientas habilitadas y probá primero una consulta de solo lectura. `autonexus_request_appointment`
   crea una propuesta `PENDING_REVIEW`; el personal puede aprobar o rechazarla desde Operaciones.
   Si el resultado tarda o se pierde, usá `autonexus_get_appointment_request` con el mismo `operationId`.

AutoNexus nunca pide, guarda ni muestra el client secret de ChatGPT. La compatibilidad depende de
la disponibilidad de apps MCP personalizadas en el workspace y de un despliegue OAuth real; las
pruebas locales no verifican una conexión con ChatGPT.

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
La app de ChatGPT necesita un endpoint de Internet HTTPS estable y OAuth compatible; localhost
no es alcanzable desde ChatGPT cloud. La pantalla no prueba una sesión real de ChatGPT. El BFF,
la aserción entre servicios, la ubicación/retención del archivo persistente y el despliegue OAuth
deben configurarse antes de una operación externa real.

Audit JSONL con actor/cliente/herramienta/correlationId/código/tiempo, sin argumentos, tokens
o cuerpos. Herramientas read-only tienen anotaciones, pero la autoridad se aplica en servidor
y owner; las anotaciones no son un control de seguridad. No se considera validado ni desplegado
en producción por esta base. n8n funciona separado y no necesita este proceso para sus lecturas.

---
feature: mcp-read-n8n
status: in-progress
updated: 2026-11-05
source: work/marcelo
---

# MCP de consulta y primer flujo n8n de lectura

## Report

## [S1] Problem

CU27 quedó integrado/publicado en 8bb0ca9. Órdenes, agenda y avances ya existen, pero
`integration/mcp-server` y `infra/n8n` siguen reservados. El siguiente incremento expone
consultas limitadas a clientes externos y una ejecución manual n8n sin esperar cobros o
indicadores, sin dar por completos CU28/CU31 ni inventar permisos para una identidad técnica.

## [S2] Design

### [S2.1] Proceso y protocolo

Servidor MCP TypeScript independiente de los agentes internos, sin base de negocio. Streamable
HTTP stateless en loopback3006 para verificación local, SDK oficial v2: server/client2.4.0,
node2.1.2 y express2.0.2, versiones observadas en el registro; Node22.22.3/pnpm12.6.0 del
repositorio. La versión de protocolo y compatibilidad se negocian con el SDK; no se implementa
JSON-RPC manual ni se copia el ejemplo SDKv1 del skill como API actual.

### [S2.2] Identidad y autoridad

MCP acepta únicamente tokens RS256 de issuer configurado, audiencia propia canónica
`http://127.0.0.1:3006/mcp` y el alias del propio requester `autonexus-mcp-server`, sin
audiencias de las APIs en ese token. Keycloak exige el alias de requester para permitir el
exchange. Verifica expiración/typ/sub y cliente prerregistrado autorizado. Publica
metadata RFC9728 y challenges OAuth; valida Host/Origin, tamaño, frecuencia y concurrencia.
Permisos por herramienta = alcances OAuth del cliente y allowlist local activa; los propietarios
revalidan usuario/acción/registro. No se acepta un token destinado solo a las APIs ni se reenvía
el token MCP directamente: Keycloak standard token exchange obtiene un access token acotado a
Operaciones/Empleados, conservando el mismo sub. Secretos de ese cliente viven solo en MCP,
no en herramientas, logs, BFF, n8n ni navegador. Sin refresh token de token exchange.

Registro local de clientes es configuración administrativa explícita y falla cerrado; no es
el CRUD web de CU31. Suspenderlo impide nuevas consultas al revisar su estado por petición.
No se promete revocar mágicamente sesiones/JWT; se documentan las ventanas del propietario.

### [S2.3] Seis consultas y proyección

Contrato `contracts/mcp/consultation.md`: listar/detallar órdenes globales autorizadas;
consultar agenda propia/equipo; consultar ejecución/avances propios/equipo por assignmentId.
Solo GET de rutas propietarias fijas y argumentos de claves cerradas. Sin SQL, URLs o métodos
arbitrarios. Fechas civiles La Paz hasta31 días; paginación20 por defecto, máximo50.
Órdenes no tienen filtro de fecha y no son un alcance propio. Las proyecciones excluyen datos
de clientes/vehículos, precios, notas/descripciones, archivos y URLs; los avances iniciales
exponen únicamente metadatos/timestamps/minutos y conteos. No se convierte un403/404/503 en
un vacío exitoso. Respuestas estructuradas y texto, anotaciones read-only y límites de tamaño.

### [S2.4] n8n manual independiente

Primera exportación sin secretos: disparador manual → consultas REST autorizadas de
órdenes/agenda/evaluación de avances → resumen estructurado con período, fuentes y resultado
de ejecución. Credencial OAuth delegada de un empleado activo con roles/claims restringidos
a permisos de lectura, cifrada por n8n. Funciona con MCP detenido. Sin avisos, destinatarios,
LLM, escritura empresarial, RabbitMQ nuevo ni activación de programación.

Los flujos programados de la referencia requieren identidad técnica mínima, pero los contratos
CU05/CU16 vigentes niegan agenda/ejecuciones a un sub sin vínculo laboral activo. Ese conflicto
queda explícito: no se relaja el owner, no se finge un empleado de máquina y no se declara
el flujo manual como automatización desatendida ni CU28 completo.

### [S2.5] Auditoría y prueba

MCP registra cliente/actor/herramienta/correlationId/resultado/tiempo, no tokens, argumentos
libres, datos personales, cuerpos upstream o URLs firmadas. Cliente oficial externo ejecuta
descubrimiento e invocación real contra APIs existentes; negativos de autenticación, alcance,
cliente suspendido, IDs inválidos, privacidad y owner403/404. Las pruebas con dobles se
identifican como unitarias. La ejecución real de n8n conserva resultado y no altera órdenes.
No se acredita integración solo por build o importación de workflow.

## [S3] Out of Scope

CU30 escrituras, CRUD web CU31, avisos/envíos externos, programación con identidad técnica aún
no acordada, nuevos eventos/colas, agentes internos/reportes generativos, finanzas/indicadores,
despliegue cloud y cambios a autorización propietaria. No implica completar todos los flujos CU28.

## Tasks

- [x] T1: Contratos cerrados de consulta/identidad/proyección — acceptance: rutas/permisos/scopes/errores y límites publicados (covers: S2.2,S2.3,S2.4).
- [x] T2: Proceso MCP independiente con SDK oficial y GETs de propietario — acceptance: build/tests y cliente MCP descubre/invoca herramientas autorizadas (covers: S2.1,S2.2,S2.3).
- [ ] T3: n8n manual sin secretos ni dependencia MCP — acceptance: ejecución real consulta registros existentes y conserva resultado, con MCP detenido (covers: S2.4).
- [x] T4: Negativos reales/auditoría/revisión/documentación — acceptance: denegaciones y proyección observadas, secretos ausentes, revisión focalizada y evidencia distinguen creado/compilado/integrado/probado (covers: S2.5).
## Journey log

- **Sesión administrativa de 60 s**: el primer `--apply` falló con `IDP_HTTP_401` a los 71 s. El token del realm `master` no trae `sub`, así que el ancla es `sid`; se renueva con el refresh token y se permite un solo reintento tras 401.
- **Mappers de Keycloak**: añade `userinfo.token.claim`; la comparación exige identidad y configuración del mapper y solo tolera esa clave extra.
- **Scope `basic`**: restringir todos los default scopes retiraba `sub` del token real. Se restituye solo `basic`.
- **Etiquetas Compose**: `cu16-proof` conserva la etiqueta del worktree personal; se admite explícitamente la raíz o ese worktree exacto, sin recrear contenedores ni volúmenes.
- **Período de agenda**: el adaptador podía publicar el rango solicitado sin confirmar el del propietario; regresión roja y validación de `from`/`to`/`timeZone`/`observedAt`.
- **n8n y OAuth2**: la credencial confidencial exige el primer consentimiento en navegador; el flujo se importa y persiste inactivo, sin acreditar ejecución.
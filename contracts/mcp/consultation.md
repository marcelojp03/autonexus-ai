# CU29 — primer contrato MCP de consulta

Diseño del incremento en `docs/compose/spec/mcp-read-n8n.md`. No es CU30 ni el CRUD CU31.
Proceso independiente, transporte Streamable HTTP y herramientas de solo lectura.

| Herramienta | REST de Operaciones | Alcance OAuth MCP | Permiso propietario |
| --- | --- | --- | --- |
| `autonexus_list_orders` | GET /orders | mcp:orders:read | orders:read |
| `autonexus_get_order` | GET /orders/{id} | mcp:orders:read | orders:read |
| `autonexus_list_my_agenda` | GET /agenda/me | mcp:agenda:read:self | agenda:read:self |
| `autonexus_list_team_agenda` | GET /agenda/team | mcp:agenda:read:team | agenda:read:team |
| `autonexus_get_my_execution` | GET /executions/me/{assignmentId} | mcp:executions:read:self | executions:read:self |
| `autonexus_get_team_execution` | GET /executions/team/{assignmentId} | mcp:executions:read:team | executions:read:team |

Los alcances MCP no son nuevas entradas del catálogo de permisos empresariales. Cliente activo,
allowlist de herramientas y scope exacto no sustituyen la autorización del propietario. Agenda/
ejecución exigen empleado activo vinculado al sub actual: no hay excepción de infraestructura.
Órdenes son lectura global por permiso; no deben describirse como datos propios de un mecánico.

## Entradas

- Objetos de claves cerradas, UUID estrictos para id/assignmentId/employeeId. No hay URL/método/query libre.
- Listar órdenes: limit1–50/default20, offset0–100000/default0, status opcional dentro de los
  filtros existentes (`pending_quote`, `quote_requested`, `quote_approved`, `cancelled`,
  `confirmation_pending`, `confirmed`). No se ofrece completed ni filtro de fecha que el API no admite.
- Agenda: from/to obligatorios YYYY-MM-DD válidos, intervalo inclusivo hasta31 días en
  America/La_Paz; priority opcional baja/normal/alta/urgente; misma paginación; employeeId solo equipo.
- Ejecución: assignmentId (no orderId), advanceLimit1–50/default20, advanceOffset0–100000/default0.
  El owner entrega un agregado sin paginación; el adaptador limita bytes de entrada y pagina su
  proyección local. Si excede el límite, devuelve error explícito, no datos incompletos como total.
- responseFormat json/markdown opcional; misma proyección en ambos formatos.

## Salida y errores

Envelope con source=operations, observedAt, alcance y período cuando corresponda, datos
proyectados y paginación (`total`, `limit`, `offset`, `hasMore`, `nextOffset`).
Órdenes: IDs/número/estado/prioridad/versiones/fechas y servicios sin tarifas. Agenda:
asignación/orden/intervalo/prioridad/estados/versiones/progreso. Ejecución: IDs/estado/inicio/
versión; avances id/sequence/minutesWorked/occurredAt/recordedAt/version y conteos de evidencia.

Se excluyen cliente/contactos/documentos, vehículo/matrícula, notas/descripciones, importes/
cotizaciones, objetos/nombres de archivo, imágenes y URLs. Sin passthrough de DTO propietario.
Notas o resultados no conceden autoridad ni se interpretan como instrucciones.

401 de autenticación MCP y403 de alcance usan challenges OAuth. Herramienta desconocida y
argumentos inválidos usan el SDK. Denegación/404/dependencia propietaria se devuelven saneadas
como error de herramienta con código/status; no se convierten en []/total0. Respuestas limitadas,
sin stack, token o body upstream. Auditoría solo metadata de actor/cliente/operación/resultado.

## Token y registro

Solo token del issuer configurado con la pareja exacta de audiencias propia: recurso canónico
MCP y alias de requester `autonexus-mcp-server`, cliente prerregistrado activo y scopes permitidos.
El alias es del mismo servidor MCP y permite el exchange de Keycloak; no es una audiencia API.
Metadata RFC9728, Host/Origin limitados y proceso separado. Token exchange
standard de Keycloak obtiene audiencia Operaciones+Empleados con mismo sub, sin refresh ni
impersonación. No se reenvía directamente un JWT de API o el token MCP a un propietario.
La política local de cliente se revisa por petición; no equivale a implementar CU31 web.

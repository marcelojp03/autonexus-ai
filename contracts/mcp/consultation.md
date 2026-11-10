# CU29 — primer contrato MCP de consulta

Diseño base CU29 en `docs/compose/spec/mcp-read-n8n.md`; se amplía con CU30 y la administración
de clientes CU31. Proceso independiente, transporte Streamable HTTP en `/mcp`.

| Herramienta                         | REST de Operaciones                                | Alcance OAuth MCP             | Permiso propietario  |
| ----------------------------------- | -------------------------------------------------- | ----------------------------- | -------------------- |
| `autonexus_list_orders`             | GET /orders                                        | mcp:orders:read               | orders:read          |
| `autonexus_get_order`               | GET /orders/{id}                                   | mcp:orders:read               | orders:read          |
| `autonexus_list_my_agenda`          | GET /agenda/me                                     | mcp:agenda:read:self          | agenda:read:self     |
| `autonexus_list_team_agenda`        | GET /agenda/team                                   | mcp:agenda:read:team          | agenda:read:team     |
| `autonexus_get_my_execution`        | GET /executions/me/{assignmentId}                  | mcp:executions:read:self      | executions:read:self |
| `autonexus_get_team_execution`      | GET /executions/team/{assignmentId}                | mcp:executions:read:team      | executions:read:team |
| `autonexus_request_appointment`     | POST /appointment-requests                         | mcp:appointments:request      | appointments:write   |
| `autonexus_get_appointment_request` | GET /appointment-requests/operations/{operationId} | mcp:appointments:request:read | appointments:write   |

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
Órdenes: IDs/número/estado/prioridad/versiones/fechas y servicios sin tarifas. Agenda: servicios sin tarifas, además de
asignación/orden/intervalo/prioridad/estados/versiones/progreso. Ejecución: IDs/estado/inicio/
versión; avances id/sequence/minutesWorked/occurredAt/recordedAt/version y conteos de evidencia.

Se excluyen cliente/contactos/documentos, vehículo/matrícula, notas/descripciones, importes/
cotizaciones, objetos/nombres de archivo, imágenes y URLs. Sin passthrough de DTO propietario.
Notas o resultados no conceden autoridad ni se interpretan como instrucciones.

## CU30 — solicitud pendiente, nunca reserva

`autonexus_request_appointment` acepta claves cerradas `operationId`, customerId, vehicleId,
serviceId, startsAt con offset, timeZone IANA y notes opcional acotada. Requiere client scope,
permiso efectivo `appointments:write` del empleado delegado, y una firma MCP→Operaciones que
vincula clientId, subject y operationId. El propietario valida referencias/relación cliente-
vehículo y registra `PENDING_REVIEW` con replay de mismo payload; otro payload para el mismo ID
conflicta. La reconciliación firma la lectura y restringe el resultado al mismo clientId y subject
que originaron la solicitud. La fila pendiente no reserva el horario. Si la llamada queda incierta, se consulta
`autonexus_get_appointment_request` con el mismo operationId antes de reintentar.

La cola del personal permite rechazar con motivo o aprobar con horario confirmado. La aprobación
revalida cliente/vehículo/servicio y disponibilidad en la transacción propietaria, creando una
sola cita mediante operationId derivado estable. La API de MCP no expone confirmación directa.

## CU31 — registro externo

`mcp-clients:manage` habilita la pantalla Empleados → Seguridad → Integraciones MCP y cada
operación GraphQL del BFF; solo el rol inicial administrador lo recibe. BFF usa un token privado
de servicio para CRUD del registro MCP. El registro acepta solo clientId, nombre, estado y scopes
de la allowlist, con escritura atómica, auditoría de metadata y una sola instancia por archivo.
No se registran secretos OAuth ni tokens.

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

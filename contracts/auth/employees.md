# CU03 — Empleados: autenticación y semántica pública

Contrato temprano de S2.2–S2.5 de la especificación aprobada `docs/compose/spec/cu03-employees.md`. OpenAPI: [employees.openapi.yaml](../rest/employees.openapi.yaml). SDL web ejecutado por `integration/bff`: [employees.graphql](../graphql/employees.graphql). No acredita backend integrado, BFF, CU02 ni CU03 web completo.

## Fronteras y autorización

- **Todas** las operaciones REST (listado, detalle, alta, PUT, desactivación, historial y retry) requieren rol realm `administrador`, con política servidor por acción/registro. No hay lectura pública ni excepción para mecánicos/jefes o para la propia ficha.
- Reutilizar guard CU01: access token RS256, issuer/JWKS confiables, audiencia `autonexus-employees-api`, exp/sub/typ y tolerancia existente de 5 s. Sin token/vencido/inválido: 401. Token válido sin permiso: 403. No aceptar ID tokens ni roles/subject del body.
- Bloquear desactivación si el `access.subject` vinculado coincide con el subject administrador autenticado: 409 `SELF_DEACTIVATION_FORBIDDEN`. No implementar política general de último administrador (CU02).
- La web empresarial **no llama REST directamente**: usa GraphQL mediante futuro BFF del participante 2. El BFF validará sesión y permiso por operación/campo/registro (incluidos nested snapshots), y el servicio vuelve a autorizar. No confiar solo en menú, props o directivas SDL.
- BFF futuro: propagar bearer autorizado con audiencia Empleados mediante forwarding/exchange acordado. Su audiencia propia, mappers y exchange **siguen pendientes**; no se inventa una audiencia desplegada. No sustituir usuario por cuenta técnica con autoridad administrativa para eludir autorización.

## Shapes REST normativos

Campos editables completos `F` = `{firstName,lastName,document,email,phone,jobTitle,startDate,specialties}`; `specialties` es siempre array de strings, incluso vacío.

| Método/ruta | Entrada | Salida exitosa |
| --- | --- | --- |
| POST /employees | `{operationId,...F,access?:{requested:boolean}}` | 201 `{employee,replayed:boolean}` |
| PUT /employees/:id | `{operationId,expectedVersion,...F,access?:{requested:boolean}}` | 200 `{employee,replayed:boolean}` |
| POST /employees/:id/deactivate | `{operationId,expectedVersion}` | 200 `{employee,replayed:boolean}` |
| POST /employees/:id/access/retry | `{operationId,expectedVersion}` | 200 `{employee,replayed:boolean}` |
| GET /employees | `limit=20,offset=0,status?,search?` | 200 `{items:Employee[],total,limit,offset}` |
| GET /employees/:id | UUID de empleado | 200 `Employee` |
| GET /employees/:id/history | `limit=20,offset=0` | 200 `{items:EmployeeHistoryEntry[],total,limit,offset}` |

`Employee` = `{id,...F,status,version,createdAt,updatedAt,access:{requested,status,subject,attempts,errorCode}}`. UUID generado por backend; estado laboral `active|inactive`, alta activa; version entero >=1; timestamps RFC3339 UTC. `subject` es string nullable, no necesariamente UUID. Solo `subject` y `errorCode` admiten null. No campos password, credential, username, roles, enabled ni keycloakSubject de entrada/salida.

### Validación y consultas

- Recortar extremos y colapsar secuencias de espacios a uno en textos; validar longitud después de normalizar. Documento único normalizado; email válido dot-atom ASCII con dominio DNS ASCII/punycode, único sin distinguir mayúsculas, incluso para inactivos. No deduplicar por nombres.
- firstName/lastName/jobTitle: 1–100; document: 1–40; email: 1–254; phone: 7–25 caracteres del conjunto `0-9 + ( ) . -` y al menos un dígito. startDate: fecha calendario YYYY-MM-DD no futura según fecha UTC del servidor.
- specialties: 0–20 strings distintos tras normalizar espacios, 1–80 cada uno; comparación exacta sensible a mayúsculas. No convertir automáticamente un string en array.
- Rechazar tipos inválidos, nulls en entradas, propiedades desconocidas y campos administrados por servidor. PUT exige todos los F, no es PATCH y **no acepta status**. Un inactivo puede editarse, nunca reactivarse por PUT; no hay endpoint de reactivación ni DELETE.
- limit entero 1–100; offset entero 0–2147483647 (límite alineado con GraphQL Int); status opcional active/inactive; search string <=100, literal case-insensitive por firstName, lastName, nombre completo unido o documento normalizado (no regex). Vacío tras normalización equivale a omisión. GET procesa enteros decimales de query, sin aceptar coerciones booleanas/fraccionarias. Parámetros de query desconocidos o repetidos se rechazan con 400.
- Rechazar controles no representables y surrogates Unicode aislados antes de persistir en PostgreSQL; los espacios se normalizan según la regla anterior.
- Listado ordenado por createdAt ASC, id ASC; total cuenta coincidencias antes de paginar. Historial por version ASC, id ASC; mismo envelope, total de entradas del empleado. No hay snapshot de lectura entre páginas; puede variar por cambios concurrentes.

### Idempotencia, versiones e historial

- operationId UUID obligatorio en toda mutación; clave global del servicio, ligada a actorSubject, acción, empleado destino y contenido normalizado completo (incluido expectedVersion). En alta no hay destino previo. Omitir access y enviarlo false son intenciones distintas para comparar idempotencia.
- Tras autenticar/autorizar y validar estructura, buscar resultado idempotente **antes** de comprobar versión actual. Mismo operationId/contenido/actor devuelve empleado **registrado originalmente**, `replayed:true`, sin nuevos efectos, con 201 en alta y 200 en resto. No prometer estado de acceso actual en un replay: consultar detalle para refrescar. Distinto contenido/actor/acción/destino: 409 IDEMPOTENCY_CONFLICT; no devolver resultado ajeno.
- Alta version=1. PUT aceptado incrementa version una vez y genera snapshot, incluso si los F coinciden. Primera desactivación incrementa version; desactivar ya inactivo con expectedVersion vigente es no-op 200 sin otro snapshot/incremento. Toda mutación posterior exige expectedVersion vigente; conflicto 409 VERSION_CONFLICT. No revivir empleados.
- Retry no cambia version/updatedAt empresariales ni crea snapshot; exige expectedVersion vigente y requested=true, de lo contrario 409 ACCESS_NOT_REQUESTED. Reintenta/reconcilia el estado deseado más reciente; cada nueva solicitud reconcilia el estado deseado aun si estaba synced; synced es la última confirmación local, no una lectura remota continua. No duplica tareas en curso. Estado remoto jamás sustituye control de versión empresarial.
- Historial append-only por alta/PUT/desactivación efectiva: `{id,employeeId,operationId,action,actorSubject,occurredAt,version,snapshot:Employee}`; action = created/updated/deactivated. snapshot.version coincide con version; es la foto del guardado, no se reescribe por procesamiento IdP posterior. Incluye solo datos públicos de Employee y subjects de auditoría; **sin secretos**, tokens, passwords, SQL, cuerpos IdP ni stack traces.

## Acceso opcional y convergencia

- access omitido/false al crear: `{requested:false,status:not_requested,subject:null,attempts:0,errorCode:null}`, sin llamadas Keycloak. PUT omitido conserva requested. true cambia la intención a true de forma **monotónica**; false cuando ya era true devuelve 409 ACCESS_REQUEST_CANNOT_BE_REVOKED, no deshabilita cuenta ni guarda parcialmente la edición.
- Solo desactivación laboral solicita enabled=false; requested permanece true. PUT de empleado inactivo y retry nunca habilitan su cuenta. Solicitar por primera vez acceso para un inactivo prepara identidad deshabilitada; no reactiva empleado ni concede permisos.
- status de acceso: not_requested, pending, synced, failed, conflict. synced significa que coincide la identidad deseada, **no** que haya roles/credenciales ni acceso operativo. subject permanece null hasta confirmación y luego estable/único. attempts acumula intentos remotos persistidos por empleado. pending/synced limpian errorCode; failed/conflict incluyen código seguro.
- employee + auditoría + intención/resultado idempotente se confirman atómicamente en PostgreSQL propio. Procesamiento IdP fuera de transacción, serializado por empleado y versión deseada. Respuesta 201/200 puede indicar pending/failed/conflict sin revertir guardado. Timeout no confirma rechazo. 503 solo por persistencia; no por IdP caído después de guardar.
- Usuario dedicado con username determinista `employee-<employee UUID canónico minúsculo>`, atributo `employeeId` y subject persistido. No vincular por email. Verificar username/employeeId/subject antes de reutilizar tras respuesta perdida; ownership incompatible produce conflict sin tocar cuenta ajena. Reconciliar tras éxito remoto/confirmación SQL fallida, sin crear duplicados. Respuesta obsoleta no confirma versión posterior.
- ErrorCode de acceso nullable: IDP_UNAVAILABLE (conectividad/servicio), IDP_TIMEOUT, IDP_FORBIDDEN (cliente sin permiso), IDP_OWNERSHIP_CONFLICT, IDP_RESPONSE_INVALID, IDP_ACCOUNT_DISABLED (identidad deshabilitada; requiere acción autorizada separada en el IdP). No devolver mensaje original del IdP. Error remoto no se convierte en error de negocio si el empleado quedó guardado.

## Identidad técnica de backend — requisito, no provisión acreditada

Cliente confidencial dedicado de MS02, grant **client_credentials**, con service account y permisos efectivos para buscar/leer/crear/actualizar usuarios del realm (incluido enabled/employeeId). No usuario personal, password grant ni administrador bootstrap como credencial habitual. Bootstrap solo provisiona inicialmente el cliente; secreto nuevo en archivo privado separado, no en contratos, web, logs ni argumentos públicos y sin rotar secretos CU01.

No se fija aquí una configuración de roles administrativos ya desplegada. La provisión/adaptador debe documentar y comprobar el alcance efectivo mínimo disponible: los roles del token client_credentials son la intersección de scope mappings del cliente y asignaciones de su service account. Si usa realm-management manage-users/query-users/view-users, manage-users tiene alcance efectivo sobre usuarios del realm, no aislamiento por empleado. El adaptador limita escrituras a identidades con ownership verificado, no ofrece edición de roles, contraseñas ni borrado; esta restricción no equivale a aislamiento por registro del IdP. Declarar employeeId como atributo managed de User Profile con permisos view/edit [admin]; no habilitar unmanaged attributes ENABLED ni atributos arbitrarios de usuario. Destinos confiables, timeouts y sanitización obligatorios.

Las cuentas nuevas no reciben roles empresariales ni credenciales desde CU03. Habilitar credencial por flujo administrativo seguro del IdP es dependencia separada; roles requieren CU02. **Cuenta creada sin roles empresariales ni credencial habilitada no tiene acceso operativo**; synced no acredita login listo. Deshabilitar cuenta no revoca instantáneamente access tokens emitidos (límite CU01 exp+5s).

## Errores HTTP y mapping GraphQL propuesto

Negocio: `{statusCode:number,message:string,code:string}`; message sanitizado string, nunca array. Guard existente 401/403: **solo** `{statusCode,message}`, sin code.

| HTTP | code de negocio |
| --- | --- |
| 400 | VALIDATION_ERROR |
| 404 | EMPLOYEE_NOT_FOUND |
| 409 | DUPLICATE_DOCUMENT, DUPLICATE_EMAIL, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, SELF_DEACTIVATION_FORBIDDEN, ACCESS_REQUEST_CANNOT_BE_REVOKED, ACCESS_NOT_REQUESTED |
| 503 | PERSISTENCE_UNAVAILABLE |

GraphQL aún no ejecutado: UUID serializa string UUID canónico; Date/DateTime según SDL, validar parseValue/parseLiteral y serialización en servidor, sin aceptar fechas inválidas. Validar arrays reales aunque GraphQL permita coerción singleton. Int positivo para versiones y reglas REST para paginación/search; null explícito no equivale a omisión opcional.

Los resolvers propuestos son 1:1 con operationId REST: employees→listEmployees, employee→getEmployee, employeeHistory→listEmployeeHistory; mutaciones conservan createEmployee/updateEmployee/deactivateEmployee/retryEmployeeAccess. No transformar pending/failed/conflict en excepción GraphQL si guardado fue exitoso. Errores propuestos en `errors[].extensions`: `{code,statusCode}` con el code REST; 401 sin code REST se mapea a UNAUTHENTICATED, 403 a FORBIDDEN. message sanitizado en errors[].message; no filtrar cuerpos/headers internos. Esto define contrato futuro, no comportamiento de un BFF ya disponible.

La parte local del email admite átomos ASCII separados por puntos, máximo64; sin puntos iniciales/finales/consecutivos. Dominio con al menos dos etiquetas DNS de1–63caracteres alfanuméricos/guion (sin guion inicial/final), máximo253; total254. No mailbox entre comillas ni SMTPUTF8; IDN debe usar punycode. No se consulta DNS/MX.

El adaptador nunca envía enabled=true al actualizar una identidad existente: conserva o deshabilita. Una cuenta ya deshabilitada produce failed/IDP_ACCOUNT_DISABLED sin reactivarse por edición laboral. Habilitarla es acción IdP autorizada separada; CU02 no se acredita. Ante confirmación SQL fallida se conserva pending (errorCode puede permanecer null al no poder persistir); no hay código ficticio de confirmación. Si se pierde la sesión/lock SQL durante una llamada remota, la foto de perfil puede divergir; retry con un nuevo operationId reconcilia los datos vigentes incluso desde synced, sin nueva versión laboral. No se promete atomicidad ni lectura simultánea entre sistemas.

La restricción ASCII se comprueba sobre el email recortado/normalizado ANTES de toLowerCase; no se aceptan letras Unicode que se conviertan en ASCII (por ejemplo U+212A). Las mayúsculas ASCII y dominios punycode siguen admitidos.

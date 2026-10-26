# 007 — Empleados propietarios e identidad opcional recuperable

Fecha: 2026-10-26. Diseño CU03 aprobado por Marcelo en docs/compose/spec/cu03-employees.md, con identidad técnica dedicada y contratos tempranos (12f44e6). La ausencia comprobada de aplicación BFF determina una entrega backend, no CU03 web completo. CU02 sigue pendiente.

## Propiedad y reglas

UUID empresarial estable; documento normalizado y email case-insensitive únicos incluso para inactivos. Cargo laboral y especialidades son datos, no roles de seguridad. Todos los endpoints empresariales requieren administrador en servidor. Se usa la identidad CU01, no subjects/roles del body. No hay DELETE ni reactivación. Historial con actor, versión y snapshot conserva cada alta/modificación/desactivación efectiva.

PostgreSQL de Empleados conserva cuatro tablas propias: employee_records (agregado JSONB con PK, subject único, constraints y unique indexes de documento/email), employee_history, employee_operations e identity_intents. JSONB es una representación del agregado en PostgreSQL, no otra base ni modelo compartido. Dominio y casos de uso no importan Nest/TypeORM; infraestructura adapta SQL parametrizado y HTTP. Migración 1793023200000, synchronize=false y migrationsRun=false. Rollback destructivo de historial exige otra migración explícita, no down automático.

Idempotencia global por operationId, ligada a actor/acción/destino/contenido normalizado; replay devuelve snapshot guardado sin repetir efectos, antes de comprobar versión actual. PUT completo exige expectedVersion. Cada mutación usa transacción local corta para agregado, auditoría, intención y resultado. Sin transacción distribuida PostgreSQL+Keycloak.

## Cuenta técnica y frontera de confianza

Cliente confidencial autonexus-employees-admin con grant client_credentials; service account y scope mapping explícito de realm-management/manage-users. Bootstrap solo provisiona infraestructura inicialmente. El servicio NO lee credenciales bootstrap/personales: solo EMPLOYEES_IDP_CLIENT_FILE, archivo privado separado con clientId/clientSecret. Provisión idempotente obtiene/conserva el secreto existente sin rotarlo; no cambia los privados CU01. Se preservan sus fixtures.

manage-users tiene autoridad sobre usuarios del realm. La comprobación de ownership del adaptador no equivale a aislamiento IdP por empleado; no se afirma fine-grained admin permissions. El adaptador solo implementa búsqueda/alta/perfil/enabled de cuentas con username determinista y atributo employeeId administrable exclusivamente por admin. No ofrece roles, contraseñas ni borrado. Cuenta nueva sin roles empresariales y sin credencial habilitada NO tiene acceso operativo; synced solo confirma perfil/estado deseado. CU02 y habilitación segura de credencial son dependencias separadas.

## Fallos y recuperación

access.requested es explícito y monotónico. Sin solicitud no hay llamada IdP. Estado laboral y estado de sincronización son independientes. Guardar empleado puede devolver pending aunque el intento posterior termine: consultar detalle para estado actual. El replay conserva el snapshot original, no promete estado remoto vigente.

Intención durable por empleado/versión. Mutación y sincronización comparten advisory lock de sesión PostgreSQL, adquirido sin espera; contención antes del guardado da503 seguro/reintentable con el mismo operationId. El lock sigue durante la operación remota pero no hay transacción SQL abierta. Esto impide que una respuesta antigua habilite una cuenta después de desactivar. Se liberan locks/conexiones en finally.

Timeout no confirma rechazo. Username employee-UUID + employeeId + subject estable permiten recuperar una creación cuya respuesta se perdió. Ownership ajeno produce conflict sin escribir la cuenta. Si el remoto confirma y falla SQL, intención y estado pending sobreviven; retry administrativo tras reinicio reconcilia la misma cuenta. No hay worker automático: la recuperación implementada es retry administrativo explícito. Desactivar conserva datos y solicita enabled=false; el límite de JWT ya emitidos sigue siendo exp+5s de CU01.

## Integración y límites

REST funcional de propietario; OpenAPI y SDL/operaciones GraphQL propuestos versionados antes de implementación. El BFF del participante2 sigue sin generar: debe validar sesión/permiso y propagar bearer autorizado con audiencia Empleados; su audiencia propia/exchange requieren acuerdo. No se inicializa su aplicación ni se conecta mf-employees directamente a REST. NG-ALAIN y demos se conservan.

El runtime CU01 permanece en raíz. CU03 se verifica con Nest real en puerto efímero desde el worktree, contra PostgreSQL/Keycloak propietarios de raíz; no debe administrar Compose desde esa copia. Para una instancia manual simultánea se documenta PORT3003 loopback, manteniendo CU01 en3002. Esto no acredita BFF ni interfaz integrada.

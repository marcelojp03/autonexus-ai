# BFF

Tecnología: NestJS 12.2.0. Persistencia: sin base de negocio. GraphQL 17.0.2 sobre el SDL publicado; cliente HTTP hacia la API REST de Empleados.

## Estado

CU05: séptimo SDL `contracts/graphql/agenda.graphql`, override absoluto existente `BFF_AGENDA_SCHEMA_PATH`. `myAgenda`/`myAgendaWork` requieren `agenda:read:self`; `teamAgenda`/`teamAgendaWork`/`agendaTeamEmployees`, `agenda:read:team`. Catálogo cerrado de 25 permisos sin herencia por prefijo. El gateway específico reenvía el bearer humano a las cuatro lecturas `/agenda/me`/`agenda/team` (lista/detalle) de Operaciones y al selector `/agenda/team/employees` de Empleados. No infiere identidad desde roles o filtros; `employeeId` solo existe en equipo.

Los propietarios revalidan vínculo activo y permiso vigente en cada lectura; la caché general del BFF no sustituye esa autorización. DTOs exclusivos de agenda, con proyección explícita anidada y sin modelos administrativos ni financieros. Entradas desconocidas, rangos civiles inválidos, más de 31 días o paginación fuera de límites se rechazan; fechas/defaults omitidos quedan a cargo del propietario. Errores CU05 saneados: `AGENDA_ACCESS_DENIED`, `AGENDA_WORK_NOT_FOUND`, `AGENDA_DEPENDENCY_UNAVAILABLE`, `AGENDA_STATE_UNAVAILABLE`, conservando `PERSISTENCE_UNAVAILABLE` propietario. El envelope existente normaliza 403 a `FORBIDDEN`; una falla nunca se transforma en `items=[]`.

Verificación local CU05: `pnpm test --maxWorkers=1` (125 pruebas), `pnpm test:e2e --maxWorkers=1` (25 HTTP sintéticas), `pnpm typecheck`, `pnpm build` y `pnpm lint`. Evidencia ignorada en `output/cu05/bff-*` desde la raíz del worktree. Los transportes falsos y firmas RSA sintéticas no acreditan integración con propietarios reales, identidad laboral real ni UI. Sin cambios de dependencias, arranque/reinicio de servicios ni portabilidad Docker; se mantienen los validadores loopback vigentes.

CU15: SDL en contracts/graphql/confirmations.graphql, cargado por environment (override BFF_CONFIRMATIONS_SCHEMA_PATH). Cinco queries con confirmations:read y dos mutaciones con confirmations:write; permisos efectivos resueltos por Empleados, sin ACL por nombre de rol. startServiceConfirmation y retryServiceConfirmation devuelven ConfirmationSaga directa. La autorización CU03 employees:write permanece separada.

Los gateways reenvían el token humano a los endpoints públicos de Operaciones y a staffing/mechanics de Empleados. No hay coordinación de Saga, cuentas técnicas, acceso a bases ni llamadas internas desde el BFF. Solo confirmed significa éxito; 202 conserva el estado pendiente recibido. Las reservas se exponen separadas de assignments y el flag laboral usa el CRUD existente, sin defaults que alteren actualizaciones omitidas ni cambios de roles. Historiales legacy admiten mechanicEnabled=null.

Pruebas CU15 unitarias y HTTP usan fakes explícitos (test/bff.e2e-spec.ts conserva el nombre histórico); no acreditan integración real de servicios ni UI. Node 22.22.3 y pnpm 12.6.0; checks reproducibles: pnpm typecheck, pnpm test --maxWorkers=1, pnpm test:e2e --maxWorkers=1, pnpm build. Evidencia de ejecución por entrega en output/cu15/bff-*.log y .exit desde la raíz del workspace. La integración distribuida corresponde al coordinador principal.

Implementado para CU03 (Empleados). Consume `contracts/graphql/employees.graphql` como fuente única y reenvía el token del usuario a `http://127.0.0.1:3002`. No consulta PostgreSQL, no usa credenciales administrativas de Keycloak y no expone tokens.

Alcance no exclusivo (decisión 009): el BFF puede ser implementado por cualquier integrante. Decisiones de seguridad y transporte: `docs/decisions/010-bff-graphql-forwarding.md`.

## Ejecución local

Requisitos: Node 22.22.3, pnpm 12.6.0, Empleados en `127.0.0.1:3002` y Keycloak en `127.0.0.1:8180`.

```powershell
Set-Location integration/bff
$node = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3/node.exe'
$pnpm = 'C:/Users/marcelo/AppData/Local/node/corepack/v1/pnpm/12.6.0/bin/pnpm.mjs'
$env:Path = 'C:/Users/marcelo/AppData/Local/nvm/v22.22.3;' + $env:Path
& $node $pnpm install --frozen-lockfile
& $node $pnpm build
& $node dist/main.js
```

Variables admitidas (todas con default local; no hay secretos):

| Variable | Default | Regla |
| --- | --- | --- |
| PORT | 3004 | entero 1–65535 |
| EMPLOYEES_API_URL | http://127.0.0.1:3002 | solo `http` y host `127.0.0.1` |
| OIDC_ISSUER_URI | http://127.0.0.1:8180/realms/autonexus | exacto |
| OIDC_AUDIENCE | autonexus-employees-api | exacto |
| WEB_ALLOWED_ORIGINS | http://127.0.0.1:4200,4201,4202 | subconjunto exacto |
| BFF_SCHEMA_PATH | ../../contracts/graphql/employees.graphql | ruta absoluta existente |

## Superficie

`POST /graphql` con `{query, variables?, operationName?}` y `Authorization: Bearer`. Campos raíz permitidos: `employees`, `employee`, `employeeHistory`, `createEmployee`, `updateEmployee`, `deactivateEmployee`, `retryEmployeeAccess`. Una operación por petición; sin introspección ni fragmentos nombrados; profundidad máxima 6; 120 selecciones; consulta de hasta 4000 caracteres y variables de hasta 64 KB.

`GET /health/live` responde `{status:'UP'}` siempre; `GET /health/ready` comprueba alcanzabilidad de Empleados y devuelve 503 `DOWN` si no responde.

## Autorización y errores

- Token RS256 del usuario, issuer/audiencia propios, `exp`, `typ: Bearer`, tolerancia 5 s, JWKS confiable; rol `administrador` requerido.
- 401/403 de Nest: `{statusCode, message}` sin detalles.
- Errores de negocio GraphQL: `errors[].extensions = {code,statusCode}` con mensajes saneados (`VALIDATION_ERROR`, `EMPLOYEE_NOT_FOUND`, duplicados, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `SELF_DEACTIVATION_FORBIDDEN`, `ACCESS_REQUEST_CANNOT_BE_REVOKED`, `ACCESS_NOT_REQUESTED`, `PERSISTENCE_UNAVAILABLE`, `SERVICE_UNAVAILABLE`).
- Indisponibilidad del upstream se expone como `SERVICE_UNAVAILABLE` (503) y nunca filtra el cuerpo del servicio.

## Verificación

```powershell
Set-Location integration/bff
& $node $pnpm test        # 10 unitarias: allowlist, límites, mapeo de errores, historial anidado
& $node $pnpm test:e2e    # 10 HTTP: salud, 401/403, query válida, saneamiento
```

Matriz real (Empleados + Keycloak, sin mocks): `node scripts/cu03/verify-bff-real.mjs` desde la raíz del worktree. Recorrido web completo: `node scripts/cu03/verify-cu03-web.mjs`.

## Límites

No implementa audiencia propia del BFF, token exchange, cacheo, suscripciones, batching ni otros CU. La web accede solo por este BFF; el REST de Empleados no se expone al navegador.

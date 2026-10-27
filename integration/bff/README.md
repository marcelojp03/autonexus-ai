# BFF

Tecnología: NestJS 12.2.0. Persistencia: sin base de negocio. GraphQL 17.0.2 sobre el SDL publicado; cliente HTTP hacia la API REST de Empleados.

## Estado

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

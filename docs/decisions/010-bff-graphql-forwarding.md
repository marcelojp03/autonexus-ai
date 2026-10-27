# 010 — BFF GraphQL sobre la sesión del usuario

Fecha: 2026-10-27. Implementación de CU03 web bajo la decisión 009 (alcance no exclusivo).

## Contexto

La web no puede llamar al REST empresarial directamente y el `SessionPort` no entrega JWT, refresh ni ID tokens a los microfrontends. El BFF necesitaba autenticar peticiones GraphQL sin duplicar sesión ni sacar tokens a props/storage.

## Decisión

1. **Transporte desde el propietario de la sesión.** `SessionPort.requestBusiness(query, variables)` envía la petición GraphQL al BFF con el access token en RAM. El microfrontend recibe solo `{data}` o `errors[{code,statusCode,message}]`; nunca un token.
2. **Forwarding del token del usuario.** El BFF valida el mismo token que usará Empleados (issuer, audiencia `autonexus-employees-api`, firma RS256, `exp`, `typ: Bearer`) y lo reenvía. No hay exchange ni audiencia propia del BFF en esta entrega, ni credenciales administrativas de Keycloak en el BFF.
3. **Autorización doble.** El BFF exige `administrador` antes de resolver y Empleados vuelve a autorizar por endpoint. El BFF no sustituye al usuario por una cuenta técnica.
4. **Superficie cerrada.** GraphQL ejecuta únicamente los siete campos raíz del contrato, una operación por petición, sin introspección ni fragmentos nombrados, con límites de profundidad, selecciones, longitud de consulta y variables. La composición no es un proxy genérico.
5. **Sin base de negocio.** El BFF no tiene ORM, migraciones ni acceso SQL; solo HTTP a Empleados.

## Límites explícitos

- La audiencia propia del BFF, los mappers y un eventual token exchange quedan para un acuerdo posterior; no se presentan como implementados.
- Deshabilitar o cerrar sesión no revoca tokens ya emitidos: se mantiene la ventana `exp + 5s` de CU01.
- `synced` significa última confirmación local del perfil, no permiso de acceso ni lectura remota continua.
- La demo del template no monta estas rutas: requiere `SessionPort` real.

## Consecuencias

- `integration/bff` deja de ser una carpeta reservada y pasa a ser una aplicación ejecutable documentada.
- `mf-employees` gana pantallas funcionales conservando NG-ALAIN, single-spa y la sesión existente.
- El puerto local del BFF es `127.0.0.1:3004`; Empleados sigue en `3002` y Operaciones en `8081`.

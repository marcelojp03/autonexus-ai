# contracts/rest
OpenAPI, esquemas de entrada/respuesta, errores y ejemplos por servicio.

- [technical-auth.openapi.yaml](technical-auth.openapi.yaml): diagnósticos técnicos CU01; no CRUD empresarial.
- [employees.openapi.yaml](employees.openapi.yaml): contrato temprano CU03 S2.2–S2.5 aprobado para alinear implementación; todos los endpoints requieren administrador. Incluye entradas completas, paginación, snapshots, concurrencia, idempotencia y acceso IdP separado.
- [Autorización y semántica CU03](../auth/employees.md): reglas normativas complementarias y códigos de error. Contrato publicado no equivale a implementación/integración verificada.

REST empresarial no se conecta directamente a la web. El consumidor web futuro usa el BFF GraphQL del participante 2, todavía pendiente.


## Consumidor web (CU03)

El navegador no llama a este REST. `integration/bff` valida la sesión del usuario, exige rol administrador y reenvía el mismo bearer a Empleados. El BFF conserva `operationId`, `expectedVersion` y la semántica de errores del contrato; no reinterpreta estados de acceso ni convierte un guardado local en confirmación de Keycloak.
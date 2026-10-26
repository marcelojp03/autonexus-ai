# contracts/rest
OpenAPI, esquemas de entrada/respuesta, errores y ejemplos por servicio.

- [technical-auth.openapi.yaml](technical-auth.openapi.yaml): diagnósticos técnicos CU01; no CRUD empresarial.
- [employees.openapi.yaml](employees.openapi.yaml): contrato temprano CU03 S2.2–S2.5 aprobado para alinear implementación; todos los endpoints requieren administrador. Incluye entradas completas, paginación, snapshots, concurrencia, idempotencia y acceso IdP separado.
- [Autorización y semántica CU03](../auth/employees.md): reglas normativas complementarias y códigos de error. Contrato publicado no equivale a implementación/integración verificada.

REST empresarial no se conecta directamente a la web. El consumidor web futuro usa el BFF GraphQL del participante 2, todavía pendiente.


# contracts/rest
OpenAPI, esquemas de entrada/respuesta, errores y ejemplos por servicio.

CU15: [Saga y comandos aprobados de los participantes](saga.md), con vínculo financiero durable (GET de cotización no basta) y compensación conservadora. Los OpenAPI documentan las rutas y DTO del código existente y el contrato aprobado; su publicación y validación estática no acreditan pruebas HTTP ni aceptación distribuida. Evidencia de implementación/verificación: docs/context/STATUS.md y docs/compose/spec/cu15-confirmation-saga.md desde la raíz.

- [technical-auth.openapi.yaml](technical-auth.openapi.yaml): diagnósticos técnicos CU01; no CRUD empresarial.
- [operations.openapi.yaml](operations.openapi.yaml): conserva CU06–CU10 y documenta recepciones CU11, órdenes CU12 y las cinco operaciones públicas CU15. Referencias de asignación/vínculo en ConfirmationSaga, no en WorkOrder.
- [finance.openapi.yaml](finance.openapi.yaml): CU13/CU14 humanos con bearer y permiso; cuatro operaciones privadas CU15 con client_credentials y scopes acotados. JSON válido como YAML 1.2; sin credenciales. Sin APIs públicas de vínculo ni borrado de cotizaciones/decisiones.
- [employees.openapi.yaml](employees.openapi.yaml): contrato temprano CU03 S2.2–S2.5 aprobado para alinear implementación; todos los endpoints requieren administrador. Incluye entradas completas, paginación, snapshots, concurrencia, idempotencia y acceso IdP separado.
- [Autorización y semántica CU03](../auth/employees.md): reglas normativas complementarias y códigos de error. Contrato publicado no equivale a implementación/integración verificada.

REST empresarial no se conecta directamente a la web. El consumidor web es `integration/bff` por GraphQL: valida/delega y compone lecturas autorizadas, sin base de negocio ni coordinación distribuida. Operaciones coordina CU15 y llama las APIs privadas de sus participantes. Los consumidores conservan operationId/expectedVersion y no convierten 202, timeout, 5xx o GET404 desconocido en confirmación/rechazo. Ver también «Consumidor web (CU03)».


## Consumidor web (CU03)

El navegador no llama a este REST. `integration/bff` valida la sesión del usuario, exige rol administrador y reenvía el mismo bearer a Empleados. El BFF conserva `operationId`, `expectedVersion` y la semántica de errores del contrato; no reinterpreta estados de acceso ni convierte un guardado local en confirmación de Keycloak.

# Preparación remota y propuesta cloud

Propuesta, no despliegue. No se contrataron recursos ni se verificaron conexiones a servicios administrados. Los contratos y la evidencia local describen lo implementado; esta guía no acredita Inteligencia, Sincronización, offline, Flutter ni alta disponibilidad.

## Límites de portabilidad

Las imágenes OCI, HTTP/OIDC, PostgreSQL y RabbitMQ facilitan trasladar el conjunto a otro proveedor. Eso es portabilidad: no prueba una operación multinube. Una operación multinube activa necesitaría diseño de red, secretos, identidad, recuperación, residencia de datos, costos de transferencia y pruebas de fallos entre proveedores que esta entrega no incluye.

El Compose es un entorno local de un solo host. No es una plantilla certificada de producción. En particular, el servidor PHP de desarrollo y Keycloak start-dev deben reemplazarse por runtimes de producción, TLS y una gestión operativa apropiada antes de exponerlos a internet. El puerto local se publica solo en loopback; no convertir ese bind en público sin completar dicha preparación.

## Comparación de destinos propuestos

| Frontera | AWS, propuesta principal | Azure, alternativa | GCP, alternativa |
| --- | --- | --- | --- |
| Aplicaciones/Keycloak | ECS Fargate o EKS con tareas y políticas por servicio | Container Apps o AKS | GKE Autopilot |
| PostgreSQL | RDS PostgreSQL | Azure Database for PostgreSQL Flexible Server | Cloud SQL for PostgreSQL |
| RabbitMQ | Amazon MQ para RabbitMQ si la versión y funciones son compatibles; en otro caso servicio dedicado administrado u operado | RabbitMQ dedicado/administrado compatible | RabbitMQ dedicado/administrado compatible |
| Entrada HTTPS | ALB y DNS/certificados administrados | Application Gateway/ingress y certificados | Load Balancer/ingress y certificados |
| Secretos | Secrets Manager con roles de tarea | Key Vault con identidades administradas | Secret Manager con Workload Identity |
| Fotografías/documentos | S3 privado, sujeto al contrato futuro de evidencias | Mantener S3 o acordar adaptador explícito; Blob no es sustitución ya implementada | Mantener S3 o acordar adaptador explícito; Cloud Storage no es sustitución ya implementada |

No reemplazar RabbitMQ por Service Bus, Pub/Sub o SQS asumiendo compatibilidad: esta implementación usa AMQP 0.9.1, publisher confirms, mandatory, exchanges/topic bindings, ACL por productor y consumidores Inbox. Debe verificarse la semántica y versión del broker elegido. Tampoco afirmar que un servicio serverless suspendido mantiene los workers: Saga, Outbox e Inbox requieren procesos operativos, conectividad y recuperación supervisada. No hay garantía equivalente por el mero hecho de recibir HTTP200.

## PostgreSQL administrado

Cada propietario conserva base, rol, migraciones e idempotencia. El BFF no recibe acceso SQL. El IdP también necesita su base/rol aislados. En un servidor compartido, revocar accesos generales y limitar conexiones por identidad/red; no usar la cuenta administrativa de provisión como credencial de las aplicaciones.

Preparar endpoints, puerto, nombre de base, usuario, secreto y CA/TLS por propietario. Para conexión remota usar verificación completa de certificado y nombre del servidor (verify-full o su equivalente del driver). La CA debe montarse como configuración confiable; no desactivar la verificación para resolver un error de conectividad. Las variables exactas de cada adaptador se documentan con su implementación y pruebas, no como un alias universal ficticio.

Los adaptadores implementados reciben DB_HOST, DB_PORT, DB_SSLMODE (disable o verify-full) y DB_CA_FILE. Empleados/Operaciones usan DB_NAME y DB_USER; Finanzas usa DB_DATABASE y DB_USERNAME. DB_PASSWORD se entrega privadamente. Ver [plantilla sin secretos](managed-postgres.env.example). Se probaron validaciones/configuración, no un handshake contra un proveedor remoto.

El bootstrap de este Compose genera deliberadamente configuración local. Para otro orquestador, entregar su propia configuración privada en /run/config/service.env mediante el gestor de secretos elegido y preaprovisionar bases/roles; no reutilizar el bootstrap administrativo local ni esperar que variables externas sobrescriban ese archivo. Las imágenes consumidoras no requieren rutas del host ni recompilación para recibir dichos endpoints.

El bootstrap local crea roles/bases con una identidad administrativa separada. En servicios administrados que no permiten esa operación, preaprovisionar dichos recursos con autoridad administrativa y ejecutar después solo las migraciones propietarias. No ejecutar el bootstrap local contra una base remota sin revisar su alcance. No usar resets, migraciones fresh, synchronize ni recreación de volúmenes como preparación habitual.

Revisar el pool y los límites de conexión con los workers y migraciones. Empleados usa locks de sesión en planificación y transaccionales en seguridad; un pooler transaccional no equivale a una conexión de sesión y requiere validación específica. Preferir endpoints directos o un modo de pooling compatible antes de acreditar la equivalencia.

## Identidad y endpoints

Registrar un origen HTTPS público estable y callbacks/logout/orígenes exactos. El issuer validado en los JWT debe coincidir exactamente con el issuer público de Keycloak. Las URLs internas de JWKS, administración y client_credentials son configuración de despliegue confiable, nunca claims ni entradas del usuario. Las audiencias y los siete scopes de coordinación CU15 se mantienen; la conectividad no justifica ampliar autoridad.

Generar la configuración pública del navegador con endpoints no secretos. Mantener credenciales de SQL, broker, administración IdP y coordinación fuera de imágenes, repositorio y JavaScript. Las identidades de workload cloud sustituyen el mecanismo de entrega de secretos, no los permisos funcionales del usuario.

## Atlas y DynamoDB: preparación futura, no integración

Inteligencia y Sincronización no se simulan dentro del Compose implementado. Cuando existan sus adaptadores y contratos, deberán recibir configuración privada separada:

- Atlas: URI privada con TLS, base propietaria, usuario de privilegios mínimos, política de red y gestión de certificados. No crear colecciones/índices arbitrarios ni usar datos privados como demo.
- DynamoDB AWS: región, nombres de tabla sujetos a contratos y rol IAM de workload con acciones/recursos mínimos. Preferir identidad del entorno frente a access keys persistentes. Un endpoint local opcional no acredita compatibilidad ni conexión real a AWS.

Usar Atlas en otro proveedor y DynamoDB en AWS convierte la topología en dependiente de varios proveedores, pero no demuestra tolerancia a fallos multinube. Deben medirse latencia, cuotas, costos de transferencia, consistencia y recuperación antes de decidirlo.

## Antes de un despliegue real

Seleccionar región y autoridad, definir presupuesto, certificados, red privada, copias/restauración, observabilidad, retención, actualizaciones, migraciones y rollback. Luego probar conexiones TLS, login, autorización, recorrido CU15, entrega de eventos, reinicio y restauración con recursos reales. Ninguna de esas comprobaciones remotas se presenta como realizada en esta entrega local.

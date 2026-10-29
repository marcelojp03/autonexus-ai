# MS03 Finanzas
Tecnología prevista: PHP/Laravel.
Persistencia: PostgreSQL propia.
Responsabilidad: Bloque 2.
Alcance: Cotizaciones versionadas, aprobación registrada, cobros de servicios, gastos y comprobantes.
## Estado
Aplicación Laravel existente con PostgreSQL propietario, cotizaciones versionadas y decisiones CU13/CU14; T21 integra sus pantallas React. No reinicializar esta carpeta ni reemplazar sus privados/migraciones. Evidencia de las entregas previas en docs/context/STATUS.md desde la raíz.

## CU15 — participante financiero implementado localmente

Contrato normativo: contracts/rest/saga.md completo y contracts/events/cu15.v1.md, desde la raíz. Políticas aceptadas en [decisión 016](../../docs/decisions/016-cu15-confirmation-saga.md). GET /quotes/:id no crea autorización. Este participante no confirma órdenes, cobra, consulta bases ajenas ni coordina otros servicios.

| Método y ruta | Scope técnico |
| --- | --- |
| POST /internal/cu15/quote-links/{sagaId}/authorize | cu15.finance.authorize |
| POST /internal/cu15/quote-links/{sagaId}/cancel | cu15.finance.cancel |
| GET /internal/cu15/quote-links/{sagaId} | cu15.finance.read |
| GET /internal/cu15/operations/{operationId} | cu15.finance.read |

Firma/issuer/exp/nbf/audiencia propia (OIDC_AUDIENCE, default autonexus-finance-api), azp exacto autonexus-cu15-coordinator y scope exacto se verifican sin consultar roles humanos. Las rutas humanas rechazan ese cliente aunque un token incluya roles humanos. El iniciador transportado solo es metadata auditada; ningún token se guarda en ledger, auditoría u Outbox.

Body común cerrado: operationId UUID, expectedVersion entero, initiatedBy string de subject y authorizedAt ISO con offset. Autorizar añade orderId/quoteId UUID y quoteVersion entero positivo, con expectedVersion=0. Cancelar añade reasonCode tipado como identificador ASCII mayúsculo con guiones bajos, máximo 64 caracteres; expectedVersion es la versión actual (0 solo para ausencia). UUIDs y fechas se normalizan a minúsculas y UTC con milisegundos antes de calcular SHA-256 del JSON canónico de clientId/command/sagaId/body.

Envelope exacto: operationId, sagaId, command (authorize_quote o cancel_quote_link), fingerprint, outcome (applied/rejected), resource, errorCode, committedAt y replayed. Un POST aplicado devuelve 200; rechazo de negocio válido, 409 con envelope durable. GET de operación devuelve 200 incluso para un rechazo guardado; desconocido devuelve 404 OPERATION_NOT_FOUND, nunca rejected ficticio. IDEMPOTENCY_CONFLICT es un error estándar 409 fuera del ledger. Validación inválida: 400 VALIDATION_ERROR sin ledger; autenticación/autorización: 401/403 sin ledger.

Recurso normal: id/sagaId/orderId/quoteId/quoteVersion/status/version/authorizedAt/validUntil. Una cancelación de ausencia conserva solo sagaId/status/version/tombstone=true, sin inventar un ID de negocio. GET de vínculo es estado actual; ledger y replay conservan el snapshot histórico aunque el vínculo ya esté cancelado. Misma operación no añade auditoría ni evento. Un comando nuevo contra un vínculo terminal se rechaza con QUOTE_LINK_CANCELLED; no reescribe motivo/fecha de cancelación.

Códigos durables: QUOTE_NOT_FOUND, QUOTE_NOT_APPROVED, QUOTE_APPROVAL_MISSING, VERSION_CONFLICT, QUOTE_ORDER_MISMATCH, QUOTE_EXPIRED, QUOTE_LINK_CANCELLED y QUOTE_ALREADY_LINKED. GET de vínculo desconocido: 404 QUOTE_LINK_NOT_FOUND.

### Persistencia y decisiones locales

- Domain contiene calendario civil, JSON canónico y política financiera pura; Application contiene el caso de uso y puertos; Infrastructure usa Laravel Query Builder/SQL propietario, sin entidades ORM nuevas. Las excepciones de protocolo de Application se traducen a HTTP en el borde.
- Migración nueva 2026_10_28_000002_create_cu15_quote_links.php: quote_confirmation_links, cu15_operations, cu15_audit y cu15_outbox. No aplicada en la implementación inicial delegada; posteriormente el principal la aplicó antes de la verificación real, junto con E1793455200000 y O V7.
- Serialización PostgreSQL por operationId y sagaId, incluidos registros ausentes; row locks de vínculo/cotización/aprobación y exclusión por orden al autorizar. Índices parciales impiden dos vínculos activos por orden o versión cotizada. Cambio, rechazo/resultado, auditoría y Outbox se confirman en una misma transacción. Fallos SQL no se convierten en rechazo de negocio.
- Cancelar conserva cotización, ítems y decisión. La marca terminal evita autorización tardía; el vencimiento posterior no invalida un vínculo autorizado ni impide compensarlo.
- CU13/CU14 ahora leen/validan/escriben bajo transacción y row lock; las aprobadas o vinculadas no se revisan. La huella canónica de decisión incluye reason y todo el body. No se modificó el cálculo de importes.
- validUntil debe ser una fecha real YYYY-MM-DD, inclusiva America/La_Paz en creación, revisión, decisión y vínculo. La autorización toma el reloj después de adquirir los locks, no antes de una espera por concurrencia.

### Outbox y RabbitMQ

php-amqplib/php-amqplib **3.7.4** fijado en composer.json y composer.lock. Su requisito publicado ^7.2||^8.0 incluye PHP 8.4; comprobado Composer con PHP 8.4.26 y APIs de confirms/returns en documentación Context7 y código instalado. La instalación añadió cuatro paquetes, sin actualizar Laravel (12.70.2) ni dependencias existentes. Se usó --no-scripts --no-plugins; no se ejecutó scaffold, generación de .env/key ni migración.

CU15_MESSAGING_ENABLED vale false por defecto. CU15_BROKER_CLIENT_FILE apunta a un JSON privado con las claves host (string), port (entero), vhost (string, infraestructura provisiona autonexus), username y password (strings). No se usa URI con credenciales ni se registra ese archivo. No publicar secretos en ejemplos o Git.

Comando disponible: cu15:publish-outbox --once (intenta una fila elegible) o --loop. Requiere habilitación explícita. El adaptador no declara exchange, colas ni bindings: publica al exchange durable topic autonexus.business.v1 ya provisionado por infraestructura, con mensajes persistentes, mandatory, publisher confirms y handler basic.return. Un ACK con devolución, NACK, timeout o pérdida de conexión conserva el evento pendiente. La ejecución de --once puede completar dejando un intento fallido pendiente; exit 0 no demuestra entrega.

Claims SQL cortos FOR UPDATE SKIP LOCKED, lease de 30 s con propietario UUID único y marcado condicionado al propietario/lease vigente; red fuera de la transacción. Intentos, próxima ejecución con backoff acotado y PUBLISH_UNCONFIRMED quedan persistidos sin mensajes de excepción/credenciales. EventId/payload no se regeneran al reintentar. Un ACK perdido antes de marcar SQL puede producir duplicados esperados: entrega al menos una vez, no exactamente una. Finanzas no consume eventos CU15, por lo que no añade un Inbox ficticio.

### Historial de verificación local delegada

Comandos realmente ejecutados desde raíz mediante output/t21/run-check.mjs, con cwd services/finance y PHP C:/Users/marcelo/.config/herd/bin/php84/php.exe:

- Composer require php-amqplib/php-amqplib:3.7.4 --no-scripts --no-interaction --no-plugins --no-progress: exit 0, cuatro altas/cero actualizaciones, sin advisories. Log cu15-finance-composer-v1.
- PHPUnit focalizado: **24 pruebas/113 aserciones, exit 0**, calendario/JSON, invariantes financieras, ledger/replay/tombstone, HTTP/guard técnico y regresión QuotePolicy. Log cu15-finance-tests-final. El almacenamiento de las pruebas HTTP/ledger es explícitamente en memoria; firmas RSA/JWT reales de prueba y JWKS temporal, sin Keycloak real ni datos privados. No es evidencia final de SQL ni integración distribuida.
- PHP lint focalizado de implementación, migración y pruebas: exit 0 (cu15-finance-lint-final). git diff --check de services/finance: exit 0.
- artisan route:list --path=internal/cu15 y artisan cu15:publish-outbox --help: exit 0, cuatro rutas y comando registrados.
- Composer validate --no-check-publish --strict --no-plugins: exit 1 únicamente por advertencia de pin exacto 3.7.4, conservado intencionalmente. No hay error de esquema/lock.
- Composer validate --no-check-publish --no-plugins: exit 0 con la misma advertencia (cu15-finance-composer-validate-final). Todos los logs/archivos .exit citados están bajo output/t21/ ignorado, desde raíz.

Al terminar esa fase delegada quedaban pendientes la migración y las verificaciones de PostgreSQL, Keycloak y RabbitMQ reales. No se ejecutó entonces publisher habilitado, migración real, provisión/reinicio ni UI; tampoco commit/push o edición de STATUS/decisiones globales por el límite exclusivo services/finance. Estas restricciones históricas no describen la verificación principal posterior ni acreditan T7 por sí solas.

### Verificación principal posterior y límites

El principal aplicó las tres migraciones CU15, provisionó identidad técnica/topología RabbitMQ y desplegó los adaptadores habilitados. Evidencia ignorada en output/cu15/finance-real.json y finance-real2.log/.exit=0: seis etapas reales observadas, separadas de las 24 pruebas/113 aserciones con almacenamiento en memoria.

1. Identidad técnica real y frontera frente a tokens humanos.
2. Vínculo durable a versión aprobada y ledger atómico.
3. Replay canónico y conflicto por otro contenido, sin Outbox adicional.
4. Cancelación terminal que conserva aprobación.
5. Exclusión concurrente de vínculo en PostgreSQL con dos kernels PHP independientes y dos lock waiters observados; barrera de prueba controlada, identificada como tal.
6. Publisher confirms reales en RabbitMQ y persistencia de published_at. Un exit0 de --once aislado no sustituye esta comprobación.

output/cu15/browser-real.json y browser-real3.exit=0 acreditan además seis etapas del recorrido real desde UI, incluyendo referencias de O/E/F y recarga sin repetir efectos. distributed-real1 y distributed-real3 acreditaron concurrencia por orden/franja y rechazo F con release E en sus primeras tres etapas, pero ambas terminaron en fallo en aserciones de navegador. matrix3 también sufrió una caída espontánea del broker exit137 (OOMKilled=false), no inyectada; el principal recuperó el contenedor propio healthy. No se extrapola cobertura de caída, retornos mandatory, leases, retransmisión o todos los escenarios de recuperación desde estas seis etapas financieras.

La matriz posterior real6 quedó acreditada: output/cu15/distributed-real6.exit=0 y distributed-2026-10-29T00-21-30-311Z-0749409d.json PASS7/7. Cubre carreras por orden/franja, rechazo F con release E, respuesta perdida tras commit F sin compensar el éxito, reinicio del coordinador con IDs/cuerpos durables e identidad técnica, compensación inicialmente pendiente que termina cancel F→release E y retransmisión del mismo eventId con un Inbox/notificación. Ambos browser-proof (recovery_pending y compensation_pending) terminaron PASS con issues=[] y failed=[]. final-check6.json registra restauración DIRECT, readiness200 y flag sintético restaurado. La última corrida no tuvo caídas inesperadas. Esto no convierte las corridas fallidas anteriores en PASS. Regresión proporcional, revisión y cierre permanecen pendientes; no se declara CU15 completo ni revisión independiente. Evidencia final en [STATUS](../../docs/context/STATUS.md) y [especificación](../../docs/compose/spec/cu15-confirmation-saga.md). CU05/offline/Flutter/cobros permanecen fuera de alcance.

## Cierre CU15 observado (2026-10-28)

Revisión independiente inicial no aprobatoria de 69de9bd; C1–C4/G1 corregidos y re-revisión de 69de9bd..bdf75fa aprobatoria, sin críticos residuales. Código y evidencia integrados por FF y publicados normalmente en main/work/marcelo, con ambos SHA remotos comprobados en 0350a46dab2a7dbedb209e42f704e00f2343cae0. El cierre posterior es solo documental. Los pendientes de rondas anteriores en este README son históricos; el estado final y los límites de evidencia están en [STATUS](../../docs/context/STATUS.md) y la [especificación CU15](../../docs/compose/spec/cu15-confirmation-saga.md). CU05, offline y Flutter no se acreditan.


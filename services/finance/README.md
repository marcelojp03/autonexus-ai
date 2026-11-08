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

## CU19/CU20 — delta local y documentos privados (2026-11-07)

El ledger de cobros/gastos se carga desde routes/api.php y mantiene dominio/casos de uso
separados de HTTP y persistencia. Las migraciones000002/000003 se aplicaron al PostgreSQL
propietario existente y su segunda ejecución fue no-op; imagen Finance construida y
desplegada sin reinicializar bases. Los documentos
son opcionales: sin configuración propia no se inventa un adjunto; se devuelve
503 DOCUMENT_STORAGE_UNAVAILABLE. Un fallo SQL devuelve503 PERSISTENCE_UNAVAILABLE.

### DTO documental para BFF/SDL

| REST propietario | Permiso | Body / respuesta |
| --- | --- | --- |
| POST /expense-documents | expenses:write | operationId,fileName,contentType,sizeBytes,sha256 → ExpenseDocumentUpload |
| POST /expense-documents/{id}/confirm | expenses:write | operationId → ExpenseDocument directo |
| GET /expense-documents/{id}/download | expenses:read | sin body → FinancialFileTarget |
| PUT/GET /finance-files/documents/{id}/content | grant opaco | binario; sin Authorization ni Cookie |

Los campos corresponden a contracts/graphql/financial-ledger.graphql. El target usa URL
relativa /finance-files/documents/{UUID}/content, method PUT/GET, expiresAt UTC y headersJson
con X-Finance-Grant; PUT añade Content-Type. El proxy BFF debe preservar método, bytes,
Content-Length, Content-Type y X-Finance-Grant, pero no reenviar cookies/JWT al endpoint
binario ni al almacenamiento. Descarga responde attachment, nosniff y no-store.

expense_documents.created_at es una cadena UTC ISO de24 caracteres, no timestamp SQL
serializado con otro formato. La migración nueva2026_11_07_000003 es separada del ledger
000002; ambas quedaron aplicadas en PostgreSQL local. El esquema conserva los nombres
owner_subject/state/expense_id esperados por SqlLedgerStore; el gasto adjunta el documento
available del mismo actor dentro de su transacción existente.

### Adaptador S3-compatible independiente

FINANCE_DOCUMENT_STORAGE_FILE apunta a un JSON privado propio con endpoint, region, bucket,
accessKey y secretKey. No usar AWS_* ni copiar el perfil de Operaciones. No versionar el
archivo ni registrar sus valores. Endpoint HTTPS; HTTP sólo para loopback local. El bucket
debe estar provisionado privado, con versionado habilitado y una identidad exclusiva de
Finanzas con PutObject/GetObject/GetObjectVersion sobre su prefijo finance/expense-documents/.
El adaptador no crea buckets, políticas ni credenciales, y no requiere dependencias nuevas.

Aceptación local independiente: `infra/local/finance-documents.compose.yaml` agrega un
sidecar S3-compatible fijado a LocalStack4.0 por digest, con volumen propio, sin puerto
publicado ni Docker socket. Comparte sólo la red de Finance, por eso el perfil confiable
usa `http://127.0.0.1:4566`. Antes de usar el overlay, el operador prepara exclusivamente
`output/stack/finance-documents.private.json` con las cinco claves anteriores y credenciales
locales independientes; nunca copia el perfil de Operaciones ni versiona ese archivo.
El modo base sin overlay no exige ese perfil y falla cerrado para adjuntos.

Se ejecutaron, desde el worktree, estos pasos (rutas privadas conservadas):

```text
docker compose -p cu16-proof --project-directory <worktree> --env-file output/stack/cu16-s3.private.env -f compose.yaml -f output/stack/cu16-compose-s3.yaml -f infra/local/finance-documents.compose.yaml --profile finance-documents up -d --no-deps --no-build finance
docker exec cu16-proof-finance-1 /usr/local/bin/service-entrypoint php artisan migrate --force --no-interaction
docker compose -p cu16-proof --project-directory <worktree> --env-file output/stack/cu16-s3.private.env -f compose.yaml -f output/stack/cu16-compose-s3.yaml -f infra/local/finance-documents.compose.yaml --profile finance-documents up -d --no-deps --no-build finance-documents-storage
```

El bucket local propio se creó con `awslocal s3api`, con versionado Enabled y los cuatro
bloqueos de acceso público. La segunda migración fue no-op. No acredita AWS cloud/IAM
de producción ni sustituye el almacenamiento autorizado exclusivamente para CU16.
Suite completa propia: PHP8.4.26, **79 pruebas/524 aserciones**; la clave APP_KEY de la
suite se fijó sólo en el proceso de pruebas, sin modificar la configuración real.
Aceptación real `scripts/finance/verify-ledger-real.mjs`: **83 comprobaciones**, incluidas
dos conexiones PostgreSQL independientes, una sola recepción de dinero y documentos
versionados reales en ese S3-compatible local. Transportes falsos de PHPUnit no son
su evidencia de integración; los resultados reales están en `output/finance/cu19`.

Firma AWS SigV4 propietaria; PUT If-None-Match:* impide sobrescritura. Sin versión de objeto
real no se declara éxito. Si se pierde la respuesta/commit después del PUT, el reintento
condicionado sólo recupera el objeto existente si coincide su hash; conserva la versión
obtenida del servidor. Confirmación y descarga releen esa versión fija, verifican tamaño,
SHA-256 y firma JPEG/PNG. Los bytes se limitan a5MiB; la metadata no admite URLs/claves ajenas.
Grants aleatorios de256bits, hash persistido, TTL120s y alcance documento/método/versión.
La emisión de descarga reautoriza metadata; el BFF no recibe claves S3 ni URL S3 firmada.

Solicitud y confirmación usan financial_operations/audit atómicos, con huella actor/acción/
body normalizado. Se conservan rechazos de negocio válidos y replay, pero503 no se registra
como rechazo. Los resultados/audit nunca guardan grants/targets efímeros; replay de solicitud
puede emitir otro grant corto para el mismo documento, sin duplicar metadata o auditoría.
Consulta financial-operations clasifica request_document/confirm_document como expenses.

### Evidencia y límites de esta continuación

Comandos desde la raíz mediante output/cu27/run-check.mjs y el wrapper
services/finance/scripts/run-check.mjs, con cwd services/finance y PHP
C:/Users/marcelo/.config/herd/bin/php84/php.exe:

- finance-documents-narrow-v1: exit2, fallos iniciales de fixtures de prueba (GET JSON con
  body, bearer sintético faltante y casing de headers del fake); no se presenta como PASS.
- finance-documents-narrow-v2: PHPUnit ExpenseDocumentsTest, **9 pruebas/85 aserciones,
  exit0**. SQLite en memoria y DocumentStorage en memoria; prueba de adaptador usa HTTP fake
  y perfil temporal sintético. No acredita S3, PostgreSQL, Keycloak ni BFF reales.
- finance-ledger-routes-v1: artisan route:list --path=expense-documents, **exit0**, tres rutas
  cargadas mediante el wiring de producción, sin registro artificial en la prueba nueva.

Después de esos checks se añadió una regresión JWT de permisos documentales y se acotó la
lectura streaming de S3; su ejecución y la suite completa están pendientes de la ventana
de revisión CU28 solicitada por el principal. El PASS anterior no se extrapola a esos cambios.
La evidencia19pruebas/208aserciones del núcleo procede de la entrega del actor120, no de una
repetición efectuada aquí. No hay integración real S3 acreditada ni UI ejercitada por esta
continuación. El principal debe actualizar STATUS/decisiones compartidos: esta unidad sólo
puede modificar services/finance/**.

### Traslado documental propietario — fuente congelada, verificación focalizada

Corrección S2.6 de docs/compose/spec/financial-ledger.md: migración aditiva
2026_11_07_000004_create_document_relocations.php y comando descubierto automáticamente
en app/Console/Commands, como los publishers existentes. No cambia FinancialLedger,
HTTP/MCP, roles, perfiles activos ni tablas monetarias. La migración sólo agrega journal,
mappings inmutables e historia append-only, con triggers PostgreSQL/SQLite. No fue aplicada.

Interfaz prevista, desde services/finance con las credenciales DB del operador y el
FINANCE_DOCUMENT_STORAGE_FILE vigente (rutas ilustrativas, no ejecutar durante revisión):

~~~text
php artisan finance:relocate-documents prepare <operationId-UUID> --source-profile=<archivo-privado-origen> --target-profile=<archivo-privado-destino> --no-ansi --no-interaction
php artisan finance:relocate-documents commit <mismo-operationId-UUID> --target-profile=<mismo-archivo-privado-destino> --no-ansi --no-interaction
php artisan finance:relocate-documents status <mismo-operationId-UUID> --no-ansi --no-interaction
~~~

prepare comprueba que origen coincide con el perfil activo. Ambos stores explícitos
congelan sus perfiles al primer uso, sin alterar config global. Copia por PUT condicionado
del adaptador existente, lee versiones fijas originales y destino, verifica SHA256,
tamaño y MIME de imagen. Incluye documentos subidos aún pending, no sólo available.
Una repetición con iguales perfiles no vuelve a PUT pero sí relee/verifica los objetos.
Una respuesta perdida del PUT se recupera mediante If-None-Match y hash en el adaptador.
El proveedor/volumen original se conservan. La preparación es una transacción completa;
si falla, las copias externas ya realizadas permanecen y el mismo operationId se reintenta.

commit mantiene ACCESS EXCLUSIVE sobre expense_documents y sus tres tablas de traslado,
sin locks/SQL de tablas monetarias. SQLite usa reserva de escritura sólo para fixtures.
prepare/status usan la misma exclusión para una vista coherente. El operador debe
coordinar una ventana sin tráfico documental: los locks duran la verificación y la espera.
No hay reintento automático de transacción/handshake. Tras comprobar cobertura exacta y
releer destino, emite una línea JSON cruda y vacía buffers, todavía dentro de los locks:

~~~json
{"event":"READY_TO_SWITCH","operationId":"<uuid>","documents":1,"sourceFingerprint":"<sha256>","targetFingerprint":"<sha256>"}
~~~

El coordinador ya debe tener backup privado. Sólo al recibir READY_TO_SWITCH reemplaza
**in-place** el contenido del archivo privado activo montado, conserva el mismo path/inode
y envía exactamente SWITCHED seguido de LF por stdin del proceso, mantenido abierto
con docker exec -i u otro transporte equivalente. --no-interaction no omite esta barrera.
EOF, ABORT u otra línea abortan la transacción. Después de la señal, una instancia nueva
relee independientemente el archivo activo: su fingerprint debe coincidir con destino.
Sólo entonces actualiza object_version, inserta historia y marca committed atómicamente.
No cambia IDs, claves, hash, estado, asociación al gasto ni snapshots documentales.
Metadata que cambie entre prepare/commit exige revisión y nueva preparación: no se edita
un mapping histórico para acomodarla. Un upload adicional exige preparar su cobertura.

El resultado final es RELOCATION_STATUS con operationId, state (prepared/committed),
position (allOld/allNew/mixed), documents, old, new, unexpected, uploaded, covered y
ambos fingerprints. status sólo usa DB: puede diagnosticar aun con proveedor inaccesible.
allOld/allNew describen las referencias journalizadas; covered comprueba además todos
los documentos actualmente subidos. Versiones opacas iguales entre proveedores se
distinguen mediante historia y marca de commit, no por comparar strings únicamente.
Replay de commit ya committed/allNew devuelve status sin volver a pedir SWITCHED.
Errores son JSON RELOCATION_ERROR con código sanitizado y nextAction=status; nunca
mensajes SQL/S3, secretos, grants, tokens, perfiles, URLs firmadas ni bytes. Exit0 es éxito,
exit1 error/estado mixed y exit2 argumentos inválidos. Operación desconocida devuelve
RELOCATION_NOT_FOUND: no inventa allOld. Fingerprint SHA256 canónico de endpoint público
sin slash final, region, bucket y accessKeyHash SHA256; excluye secretKey deliberadamente.

La escritura del perfil del host y el commit SQL no forman una transacción distribuida.
Ante error/EOF/desconexión después de cambiar el archivo, consultar status con el MISMO
operationId y comparar el perfil activo; nunca revertir perfil, dinero o versiones a ciegas.
allOld con perfil destino requiere mantener la ventana y conciliar; mixed bloquea el
procedimiento. El comando no restaura archivos ni elimina objetos, providers o volúmenes.

Pruebas nuevas en tests/Feature/DocumentRelocationTest.php, escritas antes de la
implementación: idempotencia, hash origen/destino, perfil activo erróneo, cobertura,
EOF/ABORT, éxito/replay, snapshots y checksums monetarios, rollback por trigger SQLite,
historia/mappings inmutables, versiones iguales y perfiles independientes. Tras aviso
explícito del fin de revisión CU22, PHP8.4.26/PHPUnit11.5.57: 13 pruebas/46 aserciones,
exit0. El primer intento imprimió OK pero el wrapper agotó10s; no se acredita como
ejecución limpia. La repetición con presupuesto60s terminó exit0 en4,441s de PHPUnit.
Regresión ExpenseDocumentsTest + FinancialLedgerTest: 29 pruebas/329 aserciones, exit0,
incluido adaptador S3 por defecto con HTTP fake. APP_KEY sintética sólo en el proceso de
pruebas; sin modificar privados. Lint PHP de los siete archivos propios/modificados exit0;
artisan finance:relocate-documents --help --no-ansi exit0 confirma descubrimiento e interfaz.
No hubo cambios posteriores en fuentes PHP. No acredita integración PostgreSQL/MinIO,
handshake CLI contra proveedor real ni recreación persistente; son SQLite/almacenamiento
en memoria y HTTP fake. No se ejecutaron migraciones reales, cobros,83checks reales, builds
ni cambios de runtime. El principal conserva infraestructura y STATUS/decisiones globales.


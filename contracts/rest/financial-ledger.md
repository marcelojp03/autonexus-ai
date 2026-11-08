# CU19/CU20 — cobros recibidos y gastos registrados

Propietario: Finanzas. Gestión web por GraphQL/BFF; integración propietaria REST. Sin consultas
a bases ajenas. Ningún total del cliente, cotización aprobada o cierre técnico acredita cobro.

## Recorte de cobro y obligación válida

Pagos parciales siguen sin aprobación en PROJECT/referencia09. La consulta al usuario se cerró
sin elección: este primer incremento NO los presume. Sólo admite cancelar íntegramente el saldo
de una orden completed de CU17 con Saga CU15 global confirmed. No anticipos, sobrepagos, crédito,
devoluciones implícitas ni entrega automática. La política se publica como FULL_AFTER_COMPLETION_V1;
ampliar abonos requiere decisión nueva. Esto es una restricción conservadora, no aprobación de abonos.

Operaciones: GET /orders/{orderId}/collection-context, permiso payments:read O payments:write y
empleado activo vinculado, revalidado. DTO mínimo: orderId,orderNumber,orderVersion,orderStatus,
sagaId,sagaStatus,quoteId,quoteVersion,quoteLinkId,eligibleForCollection,reasonCode,observedAt.
Identificadores/versiones pueden ser null si no hubo confirmación global. No importes, personal,
reserva ni consultas a Finanzas. 404 inexistente; 403 sin contexto; 503 si no puede autorizarse.

Finanzas contrasta ese contexto online con su vínculo active y la MISMA Saga/orden/cotización/
versión/link. Lee el total DECIMAL de la cotización inmutable vinculada, no referenceRate ni
última versión. Una oferta que vence después de confirmarse CU15 no borra la obligación pactada.
La primera recepción crea snapshot local junto al pago; las consultas no generan un cobro ni
autorización nueva. Registros previos permanecen aunque falle una consulta o cambie disponibilidad.

## Dinero y comandos

BOB en este incremento. Todos los valores monetarios nuevos son cadenas de centavos enteros,
sin signo para importes, máximo 999999999999 (DECIMAL12,2 existente). Recibido/gasto >0. Sin floats
en cálculo ni transporte nuevo; cotizaciones existentes conservan su contrato. paidAmountMinor
= SUM pagos registrados; balanceMinor = agreedAmountMinor - paidAmountMinor, bajo bloqueo local.
Saldo imposible/negativo falla cerrado. Acordado cero no significa dinero recibido.

Métodos configurados: cash, bank_transfer, qr. Efectivo requiere confirmar recepción. Referencias
no efectivas exigen un registro previo de comprobación HUMANA, emitido por Finanzas con actor,
fecha servidor, orden/método/importe y nota; no se acepta referenceVerified=true del cliente.
No se atribuye comprobación automática al banco. Referencia canónica trim/mayúsculas ASCII,
3–120 caracteres alfanuméricos, guiones, barras o underscore; una referencia no se consume dos
veces ni se reutiliza para otra orden/importe. Verificación y cobro necesitan payments:write.
Repetir la comprobación con una intención nueva permite recuperar su registro original
únicamente si sigue sin consumir y coinciden actor/vínculo laboral, orden, método, importe
y referencia canónica. Se reautoriza al propietario; se conserva ID, nota, responsable y
fecha originales y se audita la nueva solicitud, sin otra verificación ni dinero nuevo.
Referencia consumida o ligada a otros datos/persona mantiene PAYMENT_REFERENCE_ALREADY_USED.

operationId UUID obligatorio; huella actor+acción+destino+contenido normalizado+versión. Cambio,
resultado, comprobante y audit son atómicos. Mismo ID/cuerpo devuelve resultado original con
replayed=true; otro cuerpo da409 IDEMPOTENCY_CONFLICT. Rechazos de negocio válidos se registran
como rejected sin dinero nuevo; errores técnicos/transporte no son rechazo confirmado. Después
de un timeout se consulta/reintenta el MISMO comando. Una decisión nueva tras rechazo confirmado
usa otro operationId explícito, nunca se cambia a ciegas el cuerpo pendiente.

## REST Finanzas

| Método/ruta | Permiso | Semántica |
| --- | --- | --- |
| GET /receivables?status=pending|paid|all&limit=&offset= | payments:read | Proyección de vínculos y contexto global; importe acordado, pagos y saldo del servidor |
| GET /receivables/{orderId} | payments:read | Detalle, historial y versión de saldo (0 sin ledger todavía) |
| GET /payments?from=&to=&limit=&offset= | payments:read | Cobros registrados del propietario, independientes de disponibilidad actual de Operaciones |
| POST /orders/{orderId}/payment-reference-verifications | payments:write | operationId,method,amountMinor,reference,note; comprobación humana explícita y auditada |
| POST /orders/{orderId}/payments | payments:write | operationId,expectedVersion,amountMinor,method,confirmReceived=true,referenceVerificationId opcional sólo si corresponde |
| GET /payments/{paymentId}/receipt | payments:read | Comprobante interno inmutable: IDs/número, orden, importe, método, fecha y responsable; no factura fiscal |
| GET /expense-categories | expenses:read | Categorías activas configuradas, IDs/códigos estables |
| GET /expenses?from=&to=&categoryId=&limit=&offset= | expenses:read | Listado con total del período calculado por el servidor |
| GET /expenses/{id} | expenses:read | Registro y respaldo autorizado, sin URL persistida |
| POST /expenses | expenses:write | operationId,description,categoryId,expenseDate,amountMinor,method,documentId opcional,duplicateOf/reason si se confirma gasto distinto |
| GET /financial-operations/{operationId} | read del módulo o write del actor original | Conciliación de resultado aplicado/rechazado; no crea otra operación |
| GET /financial-summary?from=&to= | payments:read Y expenses:read | Cobros recibidos/gastos registrados/movimiento neto, conteos y período; no cotizado como ingreso ni neto como rentabilidad |
| POST /expense-documents | expenses:write | operationId,fileName,contentType,sizeBytes,sha256; devuelve document,upload nullable,replayed |
| POST /expense-documents/{id}/confirm | expenses:write | operationId; devuelve ExpenseDocument directamente tras comprobar versión/hash/tamaño/firma |
| GET /expense-documents/{id}/download | expenses:read | Grant efímero de lectura de una versión fija, no URL persistida |

Cuerpos y consultas cerrados; actor/tiempo/importe pactado/saldo/número de recibo no editables.
Cada llamada nueva de estos CU verifica empleado activo y permisos actuales en Empleados, sin
excepción de cuenta técnica no vinculada. Ante indisponibilidad, 503; nunca listado/total cero ficticio.
Los GET no producen ingresos. Recibo y pago se releen sin volver a registrar dinero.

## Gastos y duplicidad

Categorías iniciales configuradas: utilities, tools, equipment_maintenance, administrative, other.
No gestión de inventario. Fecha civil válida America/La_Paz, no futura. Descripción 3–1600; importe
positivo, método del catálogo. Responsable derivado del token/vínculo, no del formulario.

Servidor compara posible duplicado por fecha/categoría/importe/método/descripción normalizada,
y por hash documental cuando existe. Exclusión transaccional por claves evita carrera de dos
altas. Sin reconocimiento devuelve409 EXPENSE_POSSIBLE_DUPLICATE con candidato autorizado;
si es otro gasto legítimo, el usuario confirma duplicateOf y motivo 10–500 mediante una NUEVA
intención explícita. El registro y la justificación quedan auditados, no se reemplaza el original.
Sin respaldo no se inventa uno. No DELETE/update de pagos, gastos, recibos o audit; anulación/
devolución futura necesita operación financiera distinta auditada.

## Respaldo privado, sin reutilizar credenciales de Operaciones

JPEG/PNG <=5MiB opcional. Finanzas posee metadatos, claves, permisos y adaptador S3; nunca acepta
URL/clave arbitraria o evidenceId de Operaciones. Configuración ausente da503 DOCUMENT_STORAGE_UNAVAILABLE,
no archivo exitoso. Perfil local S3-compatible propio puede validar integración sin recursos AWS nuevos.
No se monta ni copia el perfil AWS autorizado sólo a Operaciones.

Gestión de autorizar/confirmar/descargar por GraphQL; sólo binario por /finance-files/documents/
{UUID}/content, con grants opacos acotados emitidos por Finanzas, TTL corto y hash almacenado,
sin JWT/cookies hacia almacenamiento ni grants/URLs persistidos en resultados. PUT condicionado,
hash/tamaño/firma y versión comprobados antes de available. S3 sigue siendo privado; proxy sólo
transporta bytes acotados. Descarga reautoriza metadata y emite otro grant de una versión fija.
El gasto sólo admite documentId propio available, no adjunto pendiente o de otro actor.
El target binario tiene url relativa `/finance-files/documents/{UUID}/content`, method PUT|GET,
expiresAt y headersJson con `X-Finance-Grant` (256 bits, hash persistido, 120 s); PUT incluye
Content-Type. No query string, cookies ni Authorization. El BFF proxy limita método, ruta,
cabeceras y 5 MiB; el borde no registra el grant. La confirmación devuelve el documento directo;
el resultado durable de su operación conserva `{document,replayed}` sin grant. Repetir la
solicitud reemite un grant temporal, no otro documento.

`FINANCE_DOCUMENT_STORAGE_FILE` apunta al perfil privado propio de Finanzas
`{endpoint,region,bucket,accessKey,secretKey}`; no se versiona. Requiere versionado real;
no admite versión nula como disponible. HTTP sólo en endpoint loopback de aceptación,
HTTPS en los demás. Sin perfil se devuelve indisponibilidad explícita.

## Errores públicos principales

VALIDATION_ERROR, IDEMPOTENCY_CONFLICT, VERSION_CONFLICT, COLLECTION_CONTEXT_UNAVAILABLE,
OBLIGATION_NOT_FOUND, ORDER_NOT_FINALIZED, OBLIGATION_MISMATCH, BALANCE_INCONSISTENT,
PAYMENT_AMOUNT_INVALID, PAYMENT_PARTIAL_UNSUPPORTED, PAYMENT_EXCEEDS_BALANCE, NO_BALANCE_DUE,
PAYMENT_REFERENCE_UNVERIFIED, PAYMENT_REFERENCE_ALREADY_USED, PAYMENT_NOT_FOUND,
EXPENSE_NOT_FOUND, EXPENSE_CATEGORY_INVALID, EXPENSE_POSSIBLE_DUPLICATE,
DOCUMENT_NOT_FOUND, DOCUMENT_NOT_AVAILABLE, DOCUMENT_TYPE_NOT_ALLOWED,
DOCUMENT_STORAGE_UNAVAILABLE, OPERATION_NOT_FOUND, PERSISTENCE_UNAVAILABLE.
401/403 por autenticación/permiso;404 para registro no consultable;400 datos inválidos;409 conflicto
de negocio;503 resultado no comprobable. No se reetiquetan errores financieros como QUOTE_NOT_FOUND.

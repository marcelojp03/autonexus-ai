---
feature: financial-ledger
status: in-progress
updated: 2026-11-08
source: work/marcelo
---

# CU19/CU20 — dinero recibido y gastos propios de Finanzas

## Report

Incremento funcional parcial revisado: ledger propietario, permisos/contexto,
BFF/React, almacenamiento documental persistente y entrada local coordinada.
No entrega global mientras T8 siga abierto. Evidencia/alcance y fallos de
ejecutor en `docs/evidence/cu19-cu20-20261108.md`. Revisión independiente147
detectó2fallos corregidos; revisión149cerró ambos sin nuevos defectos concretos
en su alcance focalizado, con cumplimiento/corrección/consistencia conformes
para publicación parcial. No aprobación visual ni nuevo puntaje.

## [S1] Problem

Cotización aprobada, vínculo CU15 y confirmación global son hechos diferentes de dinero recibido.
Finanzas todavía no registra pagos/gastos ni saldos/comprobantes; las páginas template no cubren
estos CU. No hay política aprobada de abonos, verificación automática bancaria ni facturación fiscal.

## [S2] Design

### [S2.1] Obligación y recorte conservador

Contrato contracts/rest/financial-ledger.md. Primer incremento FULL_AFTER_COMPLETION_V1: cobro
íntegro de saldo tras CU17 y Saga globalmente confirmada, contrastada online con vínculo activo
y cotización exacta de Finanzas. La consulta al usuario no recibió elección; no se presume abonos,
crédito o anticipos aprobados. No se modifica el modelo académico ni se entrega vehículo al pagar.

### [S2.2] Dinero propietario y autoridad

Centavos BOB como strings, cálculo entero en servidor, snapshot de DECIMAL exacto de versión
inmutable. Pagos previos/saldo bajo bloqueo local; idempotencia por actor+intención+cuerpo,
recibo interno y audit atómicos. Referencias no efectivas: comprobación humana separada y
auditada por Finanzas, no flag del cliente ni proveedor simulado. Sólo ledger de pagos cuenta
como cobrado; el resumen financiero no suma cotizaciones aprobadas como ingreso.
Comprobación humana no consumida recuperable para el mismo actor/vínculo, orden,
medio/importe/referencia, incluso si se perdió su handle al navegar: devuelve
registro original, no otro comprobante ni nueva nota/fecha. Consumida o datos
distintos siguen rechazados. Consulta de intención usa read O write propio;
reintentar la mutación sigue exigiendo write.

### [S2.3] Gastos y documentos

Categorías persistidas, fecha/importe/método/descripción validados, posible duplicado con
exclusión concurrente y confirmación explícita de intención distinta. Respaldo opcional privado
de Finanzas: S3-compatible propio, metadatos y grants acotados, no perfil AWS de Operaciones.
Sin almacenamiento no se finge adjunto. Sin eliminación de historia ni reembolsos implícitos.

### [S2.4] Permisos y consumidores

payments:read/write y expenses:read/write se agregan primero al catálogo/contratos y mediante
migración aditiva a administrador y responsable_financiero, sin borrar personalizaciones.
Vínculo activo vigente en servidor. Operaciones expone contexto mínimo por estos permisos,
sin abrir toda la Saga/planificación. BFF sólo REST y proyección GraphQL; React sólo SessionPort,
sin JWT ni cálculos autoritativos. Estado incierto conserva operationId/cuerpo para conciliación.

### [S2.5] Aceptación incremental

Primero dominio/API/persistencia y permisos, después BFF/React y recorrido real autorizado.
Comprobar saldo pactado/cobrado, importe/ref inválidos, repetición, carrera, rollback de persistencia,
gasto duplicado/categoría/documento/permiso y consulta posterior. Revisión independiente y publicación
normal por incremento. Usar exclusivamente fixtures sintéticas, sin cargos/pagos externos reales.
Tras datos verificados, ampliar lecturas/reportes CU25/CU26 con oráculos de Finanzas, no plantillas
que inventen flujo de caja ni capacidad financiera por sumar presupuestos.

### [S2.6] Corrección de persistencia del S3 local y traslado conservador

La prueba aislada de LocalStack4.0 con PERSISTENCE=1 y mismo volumen no recuperó la
versión tras recreación. El proveedor actual con datos no se detiene ni se cuenta como
persistencia validada. MinIO local S3-compatible con datos de disco/versionado sustituye
sólo ese proveedor de aceptación; release oficial2025-09-07 y digest comprobado al instalar.
Sin puerto host, claves en archivos privados readonly, sin recursos AWS ni perfil de Ops.

Traslado privado por comando del propietario, no endpoint financiero ni tool de agente:
prepare copia cada versión a otro almacenamiento, comprueba SHA/tamaño/tipo y registra
un journal idempotente con operationId/docId/versiones/fingerprints de perfiles (sin claves).
Antes de cambiar el proveedor activo debe existir copia privada de todos los documentos
actuales y las versiones destino deben poder releerse con el mismo hash.

Commit bloquea metadata documental, revalida la cobertura de las copias y espera señal
del coordinador local tras cambiar el perfil activo. Sólo si su fingerprint coincide
actualiza las referencias opacas de versión y añade historia append-only, en transacción.
No cambian pagos/gastos/recibos/operaciones/auditoría monetaria, hashes ni bytes originales.
Si el resultado de commit es incierto, se consulta el journal: no se revierte a ciegas el
perfil ni el dinero. Estado mixto inesperado bloquea la operación para revisión.

El proveedor antiguo y sus volúmenes se conservan durante copia/validación; no se borran
documentos ni se reinicializan bases para obtener una prueba verde. La aceptación exige
recreación del proveedor persistente, relectura de versiones/hash desde Finance y
conciliación de checksums de tablas monetarias antes/después.

### [S2.7] Recuperación proporcional y entrada oficial local

Antes de reiniciar Docker se distingue cliente bloqueado de estado del motor y se
resuelven primero temporales propios. Sólo se reinicia con autorización vigente,
sin cargas ajenas activas, inventario de proyectos/overrides/volúmenes y parada
ordenada de escritores, temporizadores y emuladores. Nunca down-v/prune/reset ni
renombrado o migración durante la recuperación. Si la sonda vuelve a completar y
limpiarse, no se reinicia por rutina.

Después de estabilizar documentos, una entrada versionada coordina plataforma,
n8n y almacenamiento necesario sobre la instalación existente cu16-proof y sus
archivos/configuración. Preflight no imprime secretos ni ejecuta preparación,
semillas, importaciones o consentimientos automáticamente. Recrear Finance exige
coordinar su almacenamiento que comparte namespace. Se conserva origen/volumen
histórico; el contenedor de preparación sólo se retira tras verificar sustituto.

### [S2.8] UX aceptada sobre el build servido

Antes/después con pantallas reales desktop/teléfono; mantener Ant Design y Shell
actuales. Órdenes por número/nombre comprensible, UUID sólo secundario; importe
acordado, cobrado y saldo claramente separados y exactos. Validación junto al
campo y foco del primer error; comprobante consultable, adjunto con estados y
recuperación sin cambiar intención incierta. Verificar teclado, foco visible,
contraste, tamaños táctiles y estados carga/error/vacío. Capturas guardadas sin
inspección no acreditan UX. Delimitar recorridos y no inferir conformidad global.

## [S3] Out of Scope

Abonos no aprobados, anticipos, sobrepagos/crédito, pasarela bancaria, factura fiscal, CU18/CU21
completos, eliminación/corrección destructiva, credenciales AWS ajenas e ICONIX.

## Tasks

- [x] T1: contratos/catálogo/contexto global mínimo — acceptance: Finanzas identifica versión vinculada y servicio finalizado sin bases ajenas (covers: S2.1,S2.4).
- [x] T2: cobros/saldos/recibos y audit — acceptance: dinero sólo tras confirmación, cálculo exacto/replay/carrera/rechazos comprobados (covers: S2.2).
- [x] T3: gastos/categorías/duplicidad/documento — acceptance: persistencia propia, prevención de doble registro y respaldo privado real o indisponibilidad explícita (covers: S2.3).
- [x] T4: BFF y React — acceptance: permisos/estados, confirmación humana, incertidumbre y recibos sin JWT ni saldo cliente (covers: S2.4).
- [ ] T5: aceptación real/revisión/publicación — acceptance: fuentes y límites documentados; cobertura sólo por requisitos demostrados (covers: S2.5).
- [x] T6: persistencia documental local y traslado auditado — acceptance: copias de hash idéntico, referencias migradas sin tocar dinero, versiones recuperadas tras recreación; resultado incierto conciliado por journal (covers: S2.6, depends: T3).
- [x] T7: recuperación acotada y entrada oficial — acceptance: instalación/configuración conservadas y arranque coordinado documentado, sin otra plataforma (covers: S2.7, depends: T6).
- [ ] T8: UX financiera revisada — acceptance: evidencia real antes/después y recorrido afectado en build servido, hallazgos prioritarios corregidos con límites declarados (covers: S2.8, depends: T4).

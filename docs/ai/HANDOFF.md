# Cierre y continuidad de sesión

## Preparación EC2 de Gabriel — 2026-11-10

Usuario autorizó instalar prerrequisitos, ya completados y comprobados por SSH:
Docker29.9.3/Compose5.7.0/Buildx0.38.1, Nginx1.24.0, Certbot2.9.0 y utilidades.
Hello-world, HTTP200 local/externo, nginx -t y Docker sin sudo tras reconectar PASS.
Ver `infra/ec2/README.md`, script y decisión040. Entrega de estos cinco archivos
autorizada en `work/gabriel`, sobre el commit anterior ae5e8b5.

Todavía no se descargó ni desplegó la app en EC2. Dominios app/api de DuckDNS
no resolvían a la instancia al comprobarlos; pedir al compañero actualización DNS.
No hay certificado ni rol S3 configurado aquí. No copiar claves S3 locales al servidor.
La copia PEM y known_hosts están ignorados en output/local, sin modificar el original
de Downloads. Mantener fuera de Git; no imprimir sus contenidos.

---

## Entrega personal de Gabriel — 2026-11-10

El usuario solicita guardar y subir los cambios locales a `work/gabriel`, creada
desde `9315c9a`. Alcance: acceso permanente desde Empleados (CU03/CU02/CU01), contratos,
BFF/Keycloak, navegación/UI, manual, Word de pruebas y documentación de ML/S3.
Decisiones034–039 y STATUS detallan evidencia y límites. No integrar a main por esta
solicitud ni eliminar el stash de respaldo previo.

Publicación excluye CSV, cuentas privadas, claves y `output/`. El override S3 local
monta las credenciales readonly únicamente en Operaciones. No copiar claves a EC2:
usar rol de instancia; preparar CORS HTTPS. El bucket propio pasó 9 checks directos
y Operaciones quedó healthy; falta recorrido desde interfaz con evidencia autorizada.
Modelo servidor cargado e inferencia sintética PASS; calidad experimental, sin
exportaciones offline preparadas ni nuevo cierre CU22/CU23.

Verificación previa a subir: Shell focal 30/30 PASS; suite completa 109 PASS/11 FAIL
por Playwright ausente en el host. Escaneo de publicación sin credenciales conocidas,
incluidos XML del Word; diff --check PASS. Pruebas y builds de funcionalidades previas
documentados en STATUS. No atribuir a esta publicación aceptación integral de todos los CU.

---

Publicado **`edbceaa`** sobre `98d6f58`: T8 de Finanzas, CU26 financiero, correcciones nativas del APK y arranque local en dos caminos. Revisión independiente hecha; `CU19` y `CU20` cerrados con **62 puntos verificados**; `CU26` sigue parcial.

**Finanzas (T8).** Revisión visual hecha sobre el build servido, con capturas inspeccionadas como
píxeles (sin máscara magenta) en 1440 y 390, más conciliación requisito por requisito de CU19 y
CU20 en `docs/evidence/cu19-cu20-20261108.md` (§T8). Diez hallazgos corregidos; el más grave era
que en pantalla estrecha las tablas anchas recortaban la acción principal (abrir el cobro,
descargar el respaldo, cotizar). Ambas pantallas usan ahora presentación apilada bajo `md`, con la
acción a ancho completo y la misma fuente de datos. Estados en español, fechas en zona del taller,
política de cobro y referencias técnicas como información secundaria. `0` mutaciones GraphQL y `0`
errores de página. **CU19 y CU20 cumplen**; el cierre y los 5 puntos se anotan después de la
revisión y la publicación. P3 conocido: el enlace «Saltar al contenido» aparece cuando el navegador
lo enfoca al volver del IdP.

**CU26 financiero.** Tipo separado con documento `financial-narrative`, verificador, trabajo
aislado en `financial-jobs/`, autorización propia (`payments:read`+`expenses:read` vigentes),
GraphQL y sección de interfaz con exportación JSON/CSV. Real: cifras idénticas a Finance
(50850/8302/42548), ceros auténticos en período vacío, replay con el mismo `jobId`, conflicto por
otro período rechazado, mecánico `403`, `jobId` financiero inexistente en la ruta operativa. El
modelo se invocó y su texto **no** se publicó: primero un falso positivo de «rentabilidad»
(corregido con regresión) y después una cifra equivocada (`42.54` en vez de `425.48`); se publicó la
plantilla determinista rotulada. Agente 149/149, BFF 28/28, mf 14/14. Pendientes concretos:
recorrer la interfaz en navegador, mapear el conflicto a un código distinguible y revisar la
dureza del verificador con fechas.

**APK.** Instalado con `-r` en el S21 FE autorizado conservando datos: preparación editable,
formulario vacío, errores inline con foco y teclado numérico con «Done» verificados en el
dispositivo; correcciones de inset inferior, etiqueta «Iniciar sesión» y mensaje de validación recortado verificadas
en código (análisis 0, 29/29); su re-verificación en dispositivo quedó pendiente porque el teléfono se
desconectó.
Brecha abierta: el borrador de texto no sobrevive a volver atrás (sólo memoria).

**Arranque.** `docs/deployment/local-compose.md` separa instalación nueva y reanudación existente, y
corrige el inventario de servicios; `run.mjs` queda explícitamente como entrada de instalación
existente, no como instalador.

**Siguiente paso.** Revisión independiente del delta, corregir lo que surja, reconstruir el web una
vez con el estado final, recapturar, publicar y recién entonces registrar el cierre de CU19/CU20.
Después: recorrido visual del reporte financiero CU26 y persistencia del borrador de texto en Flutter.


Último código publicado: CU25 fuente financiera `de03fa1`, ambas ramas/remotos
confirmados. 15focales/136suite,7checks realesShell+6vacío propietario,
revisión152/153 y auditoría19rutas sin hallazgos. Sólo resumen calculado sin
LLM; CU26 financiero no implementado. Siguiente T15/T59.2: diseñar documento/
claims monetarios string y jobs/guardas/UI/exportación financieros separados
del contrato operativo, sin reabrir CU28. Visual/phone anteriores pendientes.

Código publicado confirmado: `fb27230` Finanzas/arranque/documentos y `aed5dd9`
UX operativa parcial PWA/Flutter, ambas ramas main/work/marcelo y remotas.
Verificación/revisión147/149 y auditorías97/13rutas registradas. Visual y
recorrido del APK nuevo en teléfono siguen abiertos; puntos57sin cambios.
Continuidad CU25/CU26: fuentes reales payments/expenses/financial-summary,
sin atribuir cierre de UX ni ingresos a cotizaciones.

Traspaso vigente2026-11-08: [CU22 funcional, Finanzas y ejecución local](../handoffs/2026-11-08-cu22-finance-local.md).
CoreCU22 publicado `cc32551`; traslado3documentos conservado y proveedor definitivo
activo sin reinicio global. Web3c6abd4a26b6/Financece731be00838 ya servidos, cuatro
documentos conservados; React42 y Flutter31/análisis/APK aprobados. Revisión
focalizada149conforme para publicación parcial, aún pendiente Git. UX visual y recorrido físico sin cerrar.
CU28 cerrado: no repetir su matriz. Los siguientes traspasos son históricos.

Traspaso vigente: [CU25/CU26 como reporte asíncrono, contrato conciliado y verificación en el Shell](../handoffs/2026-11-06-cu25-cu26-async-report.md). HEAD `73faf56` publicado en `main` y `work/marcelo`; CU25/CU26 siguen parciales y CU30/CU31 quedan después.

Traspaso CU28 evento: [CU28 evento + asistente/reportes asíncronos](../handoffs/2026-11-06-cu28-event-and-async-jobs.md). Orden de trabajo fijado por el usuario; CU25/CU26/CU28 siguen parciales.

Traspaso CU29: [MCP de consulta verificado; n8n importado sin ejecutar](../handoffs/2026-11-05-cu29-mcp-consultation.md). CU28/CU31 incompletos.

Traspaso CU27: [CU27 — aceptación funcional completa y publicada; siguiente MCP/n8n](../handoffs/2026-11-05-cu27-functional-continuation.md). Runtime canónico 4286; conservar perfil/cola/fotos. Entrega `9b60f98` revisada, integrada y publicada en ambas ramas. Los traspasos siguientes son históricos.

Traspaso de infraestructura: [Docker Compose local — verificado y revisado](../handoffs/2026-10-29-local-compose.md). T25 tiene aceptación funcional/revisión completas y cierre Git registrado en STATUS al ejecutarse; CU05 G2 visual sigue bloqueado por separado.

Traspaso de CU05: [F1/G1 corregidos, revisión visual pendiente](../handoffs/2026-10-29-cu05-review.md). CU05 no se declara cerrado; continúa pendiente la revisión visual (G2) hasta contar con un canal de píxeles reales.

Traspaso más reciente de CU23: [CU23 — análisis visual del servidor entregado](../handoffs/2026-11-01-cu23-visual-intelligence.md). Modelo real, MongoDB, BFF, microfrontend y verificación API/navegador; la conversión web (TFJS) queda para CU22.
Traspaso anterior: [CU16 — ejecución y evidencias cerradas contra AWS S3 real](../handoffs/2026-10-30-cu16-close.md).
Traspaso anterior: [CU15 — Saga de confirmación entregada y publicada](../handoffs/2026-10-28-cu15-confirmation-saga.md).
Traspaso anterior: [T21 — React, recepción, órdenes y cotizaciones](../handoffs/2026-10-28-t21-react-finance.md).
Traspaso operativo anterior: [CU06/CU07/CU09/CU10](../handoffs/2026-10-28-operations-base.md).
Traspaso anterior: [CU02 entregado](../handoffs/2026-10-27-cu02-security.md). Este enlace no reemplaza la plantilla siguiente.
Copiar una instancia fechada en docs/handoffs/ al cerrar una tarea importante.
- Fecha y responsable/bloque:
- Rama y commit (si existen):
- CU y objetivo:
- Archivos cambiados:
- Comportamiento implementado:
- Comandos ejecutados y resultados:
- Contratos/decisiones modificados:
- Pendientes y bloqueos:
- Próximo paso concreto:
- Datos que la siguiente sesión debe leer:
No pegar claves, tokens ni .env reales. El historial del chat no sustituye este registro.

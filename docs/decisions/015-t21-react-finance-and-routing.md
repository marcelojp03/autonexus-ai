# 015 — T21: React/Finanzas y continuidad de navegación

Fecha: 2026-10-28. Rama reutilizada: work/marcelo. Base publicada: f63ed9803dc3ec147d51b94ea847fc515628fe62.

## Decisión

Se completa la base React existente sin regenerarla ni cambiar builders/versiones para diagnosticar. Los tres módulos forman parte del mismo registro tipado del Shell. Cada uno recibe su propio basePath, assetBase y host; Finance usa /finance y /mfs/finance/. La importación valida los tres exports públicos antes de envolver ciclos de vida.

El build anterior respondía 200 pero su namespace ESM estaba vacío. La configuración de Vite conserva preserveEntrySignatures=strict: el navegador comprobó bootstrap/mount/unmount, la llamada con host conectado, MOUNTED y el desmontaje real. CSS del template, CSS-in-JS y portales AntD se contienen en ShadowRoot; @ant-design/cssinjs 2.1.2, ya usado por AntD instalado, se declara como dependencia directa. No hay iframe, marcadores insertados por tests ni estilos globales del template sobre el Shell.

## Sesión y permisos

Integrado: el Shell es el único propietario OIDC, React recibe SessionPort y usa requestBusiness. Ningún token va a props, storage o logs. Finance requiere permiso de lectura resuelto por el BFF para montar; cada operación sigue validada por servicio y BFF. La UI distingue lectura, escritura y decisión, sin matriz por nombre de rol.

Independiente: se reutiliza browser-auth con application=finance, cliente autonexus-mf-finance y origen exacto 4204. El cliente requiere basic/profile/roles, roles de taller explícitos y audiencias de Finanzas, Empleados/BFF y Operaciones. La falta inicial de basic/profile produjo tokens con roles/audiencias pero sin sub/usuario: el diagnóstico registró solo la presencia de claims, nunca los tokens, y la provisión se corrigió sin regenerar credenciales ni recrear el realm. Logout desmonta y retorna a raíz anónima; la cookie SSO permite cruzar al Shell sin otro ingreso.

## Contrato empresarial

Recepción/orden se implementan en Angular sobre los contratos entregados. La orden guarda número, prioridad, servicios, tarifas/duraciones copiadas, versión y pending_quote. La UI financiera usa orderReference, customerReference y vehicleReference por UUID; nombre y placa solo se muestran. Selección explícita de ID/orden/versión para decidir, con evidencia real obligatoria: nunca se decide la primera pending general ni se inventa evidencia vacía.

Cantidades/tarifas/descuento son propuestas editables. Importes, moneda e impuesto predeterminado proceden de Finanzas; fechas calendario usan America/La_Paz. Revisar conserva versiones superseded; las aprobadas son de solo lectura. Los reintentos inciertos del mismo contenido conservan operationId. Aprobar no confirma el servicio ni asigna mecánico; CU15 no se implementa.

## Correcciones de frontera y navegación observadas

El recorrido real detectó que el BFF convertía errores CU11/CU12 en VERSION_CONFLICT/NOT_FOUND por omitir sus códigos públicos, y no reenviaba open. Se incorporan los códigos ya contratados y el filtro booleano, con ocho pruebas de frontera (siete fallaban antes de la corrección). No se modifica la persistencia de los propietarios.

El smoke de navegación detectó URL /operations/vehicles con Router todavía en /customers, sin navegación pendiente; no era solo falta de render. Los adaptadores Angular añaden connectIntegratedRouter sobre el evento estándar single-spa:routing-event. Reconciliación únicamente dentro del prefijo propio, por API pública Router.navigateByUrl y replaceUrl, omitiendo rutas ya activas/en proceso y retirando el listener al destruir. No se accede a campos privados de single-spa-angular ni se parchea history/zone/builders. Seis pruebas focalizadas cubren límites de prefijo, raíz, query/fragmento, duplicados, secuencias de historial y limpieza.

## Evidencia y límites

Resultados de los comandos y verificadores reales en docs/context/STATUS.md y docs/compose/spec/operations-flow.md; artefactos locales ignorados en output/playwright/ y output/t21/. La revisión de cierre se registra allí, sin atribuir a pruebas con dobles una integración real.

Persistencia conservada: Spring/JdbcClient/Flyway, Nest/TypeORM para conexiones y transacciones con SQL explícito y entities:[], Laravel Query Builder; BFF sin base. Fotografías/S3, inspección IA, offline, cobros e indicadores siguen pendientes. La decisión 014 y el contrato de Saga CU15 no cambian de alcance.

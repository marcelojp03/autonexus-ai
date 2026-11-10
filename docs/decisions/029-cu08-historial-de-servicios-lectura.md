# 029 — CU08 historial de servicios como lectura de Operaciones

## Decisión (ampliada 2026-11-09)

El historial de CU08 se sirve desde registros propiedad de Operaciones mediante REST y se compone en GraphQL por el BFF. La ficha/lista general de vehículos conserva `vehicles:read`; el historial y evidencia usan el nuevo permiso mínimo `vehicle-history:read`, porque el actor mecánico enumerado por CU08 no posee acceso CRUD/lectura general de vehículos. Se concede aditivamente a `administrador`, `jefe_taller`, `recepcionista` y `mecanico`, no a `responsable_financiero`. Operaciones y BFF vuelven a resolver permisos del propietario; los nombres de rol no son prueba de acceso.

El listado incluye únicamente órdenes completadas con ejecución completada, ordenado establemente por verificación descendente e ID descendente, con páginas de hasta 100 filas. Se valida la existencia del vehículo antes de devolver una página vacía; el detalle vuelve a exigir que la orden corresponda a ese vehículo y esté completada. Los nombres de servicio se guardan como snapshot al crear cada orden y no se reconstruyen desde el catálogo actual. No se leen cronologías de propietarios ni bases de otros servicios. Los DTO de historial excluyen tarifas/campos financieros y datos personales de empleados.

## Alcance y límites

La lectura no incluye cotizaciones, datos financieros, asignaciones/personas, claves S3 ni URLs firmadas. Operaciones verifica vehículo→orden completada→ejecución completada→evidencia disponible en una sola consulta propietaria; lee la versión exacta privada de S3 y transmite bytes con `private, no-store`. El BFF exige el permiso efectivo y hace proxy acotado a 20 MiB sin guardar URL firmada. La PWA persiste un snapshot allowlisted por subject/vehículo en el IndexedDB del Shell, incluye únicamente blobs descargados online, marca fecha y estado potencialmente obsoleto al abrirlo offline y limita el paquete a 100 intervenciones y 50 MiB; una escritura atómica conserva el snapshot anterior si falla. No se fija una vigencia offline aún no acordada.

El permiso de historial no habilita la lista general de vehículos CU07. Para iniciar CU08 sin `vehicles:read`, Operaciones publica `/vehicles/service-history/vehicles`, una búsqueda requerida de al menos dos caracteres que devuelve solamente ID, placa, marca, modelo y año de vehículos registrados; no devuelve datos del propietario. BFF GraphQL y MF02 exigen `vehicle-history:read`, y Flutter usa la misma ruta REST del propietario.

## Consecuencias

- Migraciones aditivas V15 (snapshot de servicio) y Empleados `1794142800000` (permiso CU08); la segunda registra cambios de rol con auditoría y sincronización pendiente.
- El contrato/implementación web y las pruebas deterministas no acreditan una ejecución S3 real. Falta evidencia runtime con configuración S3 autorizada y pruebas propietarias/HTTP.
- Flutter implementa búsqueda mínima, historial/detalle, descarga privada online y snapshot SQLite + archivos privados con borrado por subject y reemplazo SQLite atómico tras completar las descargas. La aceptación por SDK Flutter queda bloqueada localmente: Dart 3.11.5 instalado frente a `pubspec.yaml` que requiere `^3.13.2`.
- Las pruebas Chromium de IndexedDB para aislamiento, reemplazo por cuota y logout quedaron añadidas al harness existente; no se ejecutan localmente porque falta el binario Playwright `chromium_headless_shell-1248` en la caché (`C:\Users\nelso\AppData\Local\ms-playwright`). No se instaló un navegador ni paquetes.
- El cache PWA no se guarda en Cache Storage ni conserva URLs/keys/tokens. La política Shell elimina datos del subject al logout explícito.
- CU08 sigue parcial y no debe marcarse cerrado hasta probar Flutter con el SDK requerido, ejecutar el harness Chromium y obtener aceptación runtime S3/HTTP autorizada.
- No se cambia la política de propiedad/visibilidad del cliente ni se introduce acceso del cliente final.

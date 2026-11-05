# 024 — CU27: traslado de copia local y aceptación por propietario

Fecha: 2026-11-05. Estado: implementado y verificado para reanudación PWA y aceptación móvil; cierre Git se registra en STATUS.

Se recupera la configuración S3 privada ya autorizada en CU16 y se utiliza el origen 4286, incluido
en el CORS vigente. No se crean recursos ni credenciales cloud. El perfil AWS personal es una
configuración local de verificación y solo Operaciones recibe el archivo compartido en solo lectura.

Cambiar de puerto cambia el origen de IndexedDB. Por ello el Shell ofrece exportación/importación
explícita de copia privada versionada: conserva UUID, versiones, dependencias, cuerpos por etapa,
estado terminal, archivos y revisión humana. No lleva tokens ni autorizaciones S3 efímeras.
Importar requiere el mismo subject autenticado, valida estructura e integridad, rechaza un destino
con datos y confirma trabajos/cola/subject en una sola transacción. La copia anterior se conserva.
Los datos importados nunca conceden permiso: cada operación vuelve al propietario por BFF/MS05.

La configuración pública del stack, issuer y redirects Shell se migran juntos con un respaldo
privado; secretos, subjects, credenciales y volúmenes se preservan. Los artefactos locales del modelo
se montan en solo lectura para esta verificación, sin incorporarlos al repositorio ni declararlos
redistribuibles. Android necesita un APK con el issuer público nuevo y su túnel USB correspondiente;
compilarlo no acredita instalarlo ni ejecutar el recorrido.

El rechazo de aceptación debe proceder del propietario, no de perder la sesión o de un guard del
BFF. El setup administrativo exclusivamente sintético verifica previamente la ruta de restauración.
Una asignación auxiliar de solo lectura, propiedad de la fixture, puede mantener el transporte
autenticado mientras se retira la autorización de ejecución; no se edita el rol compartido. La
restauración y retiro de la asignación auxiliar pertenecen a finally y deben observarse realmente.
Las pruebas puras de esa rutina no acreditan una revocación real ni el rechazo visible del cliente.

Evidencia: `docs/evidence/cu27-20261105.md`. La fotografía original PWA completó S3/MS04 y un replay
sin efectos nuevos; móvil completó después su propia evidencia independiente. Revisión visual comparada diferida.

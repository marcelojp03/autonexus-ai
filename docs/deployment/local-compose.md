# Entorno local integral con Docker Compose

Guía del conjunto implementado. No necesita Java, Node, pnpm, PHP ni builds previos en el host: Docker compila los fuentes y prepara la infraestructura. Se puede obtener el repositorio mediante clone o ZIP; Git no es una dependencia de los contenedores.

Comprobado con Docker29.9.2, Compose5.6.0 y contenedores Linux x86-64. No se estableció una versión mínima de Docker ni un mínimo de hardware. El primer build necesita red para imágenes y paquetes.

## Inicio rápido

Desde la raíz de una copia nueva:

~~~sh
docker compose --env-file .env.example --profile demo up --build -d
docker compose --env-file .env.example --profile demo ps -a
docker compose --env-file .env.example --profile demo logs --no-log-prefix demo
~~~

Abrir **http://127.0.0.1:4280**. Esperar aplicaciones healthy y demo con Exited(0); que up -d devuelva0 solo indica el resultado del arranque, no que un seed siga o haya terminado bien. Los one-shots config-init, provision y las migraciones también deben terminar con0. El publisher financiero permanece ejecutándose; su falta de healthcheck HTTP no equivale a un fallo ni acredita entrega de eventos por sí sola.

El perfil demo es explícito. Sin activarlo no se crean clientes, vehículos, empleados ni trabajos de muestra: bootstrap/migraciones se mantienen separados de los datos demo. El conjunto incluye solo Operaciones, Empleados, Finanzas, BFF, web, PostgreSQL/IdP y RabbitMQ reales, más preparación y verificadores opcionales. No contiene simulaciones de Inteligencia, Sincronización o MCP.

## Cuentas privadas

No hay una contraseña pública común ni un admin/admin. La preparación genera credenciales una sola vez y las conserva en volúmenes privados. Para exportar únicamente las cuentas de la aplicación, después de finalizar demo:

~~~sh
docker compose --env-file .env.example --profile demo cp demo:/demo-state/accounts.json ./demo-accounts.private.json
docker compose --env-file .env.example --profile demo cp demo:/run/config/admin-account.json ./admin-account.private.json
~~~

Estos comandos fueron ejecutados sin mostrar el contenido. Los archivos están excluidos de Git y del contexto Docker. Tratarlos como privados: no pegarlos en chat, capturas, commits ni documentación. La exportación contiene un administrador empresarial y las etiquetas mechanicA, mechanicB, chief, reception y finance; no son integrantes ni clientes reales. No exporta el administrador master de Keycloak ni los clientes técnicos.

Si ya existen los archivos locales, conservarlos y verificar antes de sobrescribirlos. Repetir el seed no cambia las credenciales. Una preparación incierta de contraseña solo puede comprobar la credencial ya generada; no la restablece automáticamente.

## Recorrido demo

1. Entrar como administrador para consultar empleados/horarios, clientes, vehículos, catálogo, recepción, órdenes y cotizaciones.
2. El escenario prepara cinco empleados vinculados, dos mecánicos distintos y dos trabajos confirmados mediante CU15 real. Una cotización aprobada por sí sola no confirma un trabajo.
3. La fecha de los trabajos es la fecha civil inicial de La Paz +7 días y se imprime en el log demo. Elegir esa fecha en la agenda: la pantalla abre el día actual y puede estar legítimamente vacía.
4. Entrar como mechanicA o mechanicB para su agenda/detalle; chief consulta el equipo con filtros. Las cuentas no se intercambian mediante tokens ni storage.

El ledger congela fechas, cuerpos e IDs. Repetir conserva ediciones de negocio y no reprograma fechas silenciosamente. Si el escenario vence o hay deriva relevante, la preparación falla explícitamente; no borrar el ledger ni resetear bases para ocultarlo. Un escenario nuevo requiere una elección explícita, por ejemplo otro nombre de proyecto/configuración, conservando la historia anterior.

La agenda es web online. No se acredita consulta offline, Flutter, lectura humana de notificaciones, ejecución/finalización ni módulos IA. La observación de Inbox es recepción técnica de un evento, no lectura humana.

## Configuración y aislamiento

.env.example contiene solo configuración pública: COMPOSE_PROJECT_NAME y WEB_PORT. PUBLIC_ORIGIN, si se declara, debe ser un origen exacto sin ruta, credenciales, query ni fragmento; por defecto se deriva de WEB_PORT. HTTP local solo en loopback; una dirección pública requiere HTTPS y preparación de producción, no exponer directamente estos runtimes de desarrollo.

Usar el mismo nombre/origen/puerto en todos los comandos de un entorno. Si se cambia el origen de un proyecto ya preparado, bootstrap rechaza la deriva en lugar de regenerar secretos o redirects. Cambios de despliegue requieren migración controlada o un proyecto nuevo explícito.

Solo web publica un puerto host, por loopback. APIs, bases, broker, master/admin IdP y salud9000 son internos. /identity mantiene un issuer público único; JWKS/admin/client_credentials internos son configuración confiable separada. No se desactiva firma, issuer, audiencia, vigencia o autorización para resolver DNS. Nginx solo adapta GraphQL y diagnósticos técnicos cerrados; no expone un REST empresarial general.

Cada aplicación monta solo su volumen de configuración. El estado canónico600 pertenece a preparación; consumidores reciben archivos444 en volúmenes propios readonly. Web/BFF no reciben contraseñas SQL, broker ni administración. Los entornos legacy infra/compose, infra/keycloak e infra/rabbitmq no se reutilizan ni se migran implícitamente. La entrada nueva no usa rutas absolutas del equipo del autor.

## Persistencia y parada

Comandos de parada/arranque conservando datos, comprobados sobre proyectos de aceptación:

~~~sh
docker compose --env-file .env.example stop
docker compose --env-file .env.example --profile demo up --build -d
~~~

No ejecutar down -v, volume rm, reset ni prune. Detener no elimina los volúmenes; reiniciar no cambia contraseñas. RabbitMQ mantiene hostname estable y su healthcheck corre como rabbitmq para no crear una cookie root antes del servidor. Los temporales Nginx quedan escribibles por su usuario no privilegiado después de validar la configuración.

No confundir una API lista con la finalización de CU15. Una Saga pendiente conserva comandos/resultados y puede recuperarse con credenciales técnicas sin el JWT del navegador. Un timeout no se presenta como rechazo confirmado.

## Evidencia de aceptación

- Copia Git sin .git, .env reales, node_modules, vendor, target ni dist del host; recetas compilaron todos los consumidores y los tres MF/Shell dentro de Docker.
- Proyecto vacío autonexus-clean-verified, puerto4282/origen correspondiente: una sola orden up --build -d con demo terminó web healthy y demo Exited(0), en320,4s con caché normal habilitada; RabbitMQ0reinicios. El nombre y puerto se parametrizaron, no se cambiaron fuentes.
- Chromium en imagen opcional: A/B/jefe, detalle, recarga, fechas La Paz bajo Pacific/Auckland, vacíos, cambio de cuenta, logout, Angular→React→Angular, ataques REST/GraphQL; cero fallos de consola/página/red/transporte en la corrida final. Capturas enmascaradas1440/390. Esto no concede aprobación visual si el canal no entrega píxeles al revisor.
- Demo repetida tras editar un cliente: credenciales, IDs, comandos y edición conservados; sin duplicar los dos trabajos iniciales.
- Caída E INYECTADA: GraphQL503 sin página exitosa vacía, restauración del mismo trabajo. Caída F INYECTADA: misma Saga recovery_pending, reserva provisional oculta; reinicio O y retorno F llevaron la misma intención a confirmed.
- Reinicio de los diez contenedores del primer entorno de prueba: mismas cinco credenciales/subjects y fingerprint canónico. Lecturas SQL readonly con credenciales separadas de propietario comprobaron referencias O/E/F, efectos lógicos únicos, Outbox financiero publicado, Inbox y una notificación por confirmación. No es una transacción global ni prueba de lectura humana.

Los verificadores opcionales están en infra/local; no son servicios de negocio. La imagen acceptance usa Chromium y dependencias de prueba; no se construye en el modo demo normal ni monta Docker socket. El supervisor externo valida ownership antes de inyectar caídas y restaura en finally. Los fixtures de aceptación son distintos del escenario demo.

Historial fallido conservado: primer build limpio falló en Finanzas (17min40s); se corrigieron extensiones redundantes y la plataforma PHP del lock. La aceptación detectó faltantes COPY de Angular, configuración de permisos F y temporales Nginx. Los primeros intentos de namespace nuevo encontraron timeout inicial IdP y carrera de cookie Rabbit; no se reinterpretan como PASS. El resultado exitoso corresponde al código corregido y volúmenes nuevos, no a esos intentos.

## Mediciones aproximadas

Docker Linux x86-64, 12 CPU disponibles y 15,4 GiB asignados al daemon. Muestra tras calentamiento de diez contenedores: 1457 MiB de RAM y 24,76 % de CPU acumulada, aproximadamente 0,25 núcleo. No es un promedio ni un requisito mínimo.

Medición adicional del proyecto aislado `autonexus-clean-verified`: 26 muestras en 89,366 s con `docker stats --no-stream` y un reinicio controlado de Operaciones. Máximos observados de los diez contenedores: **1836 MiB de RAM y 522,95 % de CPU agregada** (aproximadamente 5,23 núcleos). Los máximos de RAM y CPU pueden corresponder a muestras distintas. Todas las aplicaciones con healthcheck terminaron saludables y el publisher financiero siguió ejecutándose. Artefacto saneado: `output/stack/t25-peak-01.json`, `.exit=0`.

Ambas mediciones excluyen daemon, compiladores, host y entornos ajenos. El segundo resultado es un pico aproximado observado durante esa ventana de reinicio, no el máximo absoluto ni el pico de un build en frío: el muestreo puede omitir transitorios entre observaciones. No se presenta como dimensionamiento mínimo o garantía bajo carga.

| Imagen | Tamaño lógico aproximado |
| --- | --- |
| Empleados |369MiB|
| Operaciones/JRE |451MiB|
| Finanzas/PHP |778MiB|
| BFF |349MiB|
| Web/Nginx |115MiB|
| Preparación |369MiB|
| Verificador Chromium opcional |4578MiB|

Las capas se comparten: estos tamaños no se suman como consumo real de disco. El primer intento usó caché normal y descargó bases/paquetes; el arranque exitoso nuevo de5min20s reutilizó caché de imágenes/build. No se afirma un build corregido totalmente en frío. El tiempo depende de red, caché y recursos; no se purgó la caché ni recursos ajenos para producir una cifra.

## Preparación remota y límites

[Portabilidad y propuesta AWS/Azure/GCP](cloud-portability.md) y [plantilla PostgreSQL sin secretos](managed-postgres.env.example). Validaciones TLS/configuración comprobadas; ningún handshake RDS/Atlas/DynamoDB ni despliegue cloud se acredita. PHP artisan serve y Keycloak start-dev son exclusivamente locales, no producción/HA.

Estado técnico vigente y revisión: [STATUS](../context/STATUS.md). Diseño: [especificación](../compose/spec/local-compose-demo.md). Política: [decisión018](../decisions/018-local-compose-demo.md).

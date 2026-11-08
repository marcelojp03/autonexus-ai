<div align="center">

# AutoNexus AI

### Del ingreso del vehículo al trabajo confirmado

Gestión de un taller automotriz con identidad compartida, servicios propietarios y confirmación distribuida.

![Angular](https://img.shields.io/badge/Angular-22-DD0031?logo=angular&logoColor=white) ![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white) ![Spring Boot](https://img.shields.io/badge/Spring_Boot-4.1-6DB33F?logo=springboot&logoColor=white) ![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white) ![Laravel](https://img.shields.io/badge/Laravel-12-FF2D20?logo=laravel&logoColor=white)

**UAGRM · Ingeniería de Software II · Grupo 26**

</div>

## Un taller, un recorrido conectado

AutoNexus AI organiza el trabajo del personal de un taller: clientes, vehículos, citas, recepción, órdenes, cotizaciones, horarios y asignación de mecánicos. Una sesión común conecta los módulos Angular y React. El alcance es un solo taller, sin inventario ni venta de productos.

```text
Cliente y vehículo → Recepción → Orden → Cotización y aprobación
                                              ↓
                    Agenda del mecánico ← Confirmación del servicio
```

## Qué podés hacer

- Administrar empleados, roles y permisos; preparar jornadas y disponibilidad.
- Registrar clientes y vehículos, mantener el catálogo de servicios y organizar citas.
- Recepcionar un vehículo y crear una orden con servicios y prioridad.
- Elaborar cotizaciones versionadas y registrar aprobación o rechazo con evidencia.
- Confirmar el servicio mediante una Saga que coordina Operaciones, Empleados y Finanzas.
- Consultar la agenda propia o del equipo y el detalle autorizado de trabajos globalmente confirmados, en línea.
- Iniciar y documentar la ejecución de un trabajo asignado, registrar avances y solicitar evidencias. La carga y descarga de archivos requiere configurar AWS S3 privado; sin esa configuración no se presentan como disponibles.
- Preguntar al asistente interno con el propio acceso: responde combinando consultas autorizadas y devuelve fuentes, procedencia y límites declarados. Un modelo local (Ollama) redacta; si no responde o no cita las cifras calculadas, la respuesta lo declara en lugar de inventar datos.
- Generar el reporte narrativo de un período: las cifras las calcula el servidor de forma determinista y la narración sólo las redacta, con afirmaciones ligadas a su indicador, período y fuente, sin datos financieros. El reporte se produce como trabajo con identificador estable —recargar la página no inicia otra generación— y se puede exportar en JSON y CSV.
- Registrar el cobro íntegro del saldo de un servicio finalizado y globalmente confirmado, con comprobación humana de referencias no efectivas, conciliación de resultados inciertos y comprobante interno no fiscal. Sin pasarela, abonos ni cobros offline.
- Registrar gastos por categoría, fecha y responsable, con prevención de duplicados y respaldo privado opcional de Finanzas. El incremento tiene recorridos funcionales verificados; su conformidad visual y el cierre global CU19/CU20 siguen pendientes.

Una cotización aprobada no es todavía un servicio confirmado. La coordinación conserva sus pasos y se recupera ante interrupciones; las asignaciones provisionales no se muestran como trabajos confirmados.

## Tecnología

| Área | Implementación |
| --- | --- |
| Web | Shell single-spa, microfrontends Angular y React, GraphQL mediante BFF |
| Operaciones | Java 21, Spring Boot y JDBC/Flyway |
| Empleados y BFF | Node.js 22, NestJS y TypeScript |
| Finanzas | PHP, Laravel y Query Builder |
| Datos y eventos | PostgreSQL por propietario, RabbitMQ, Outbox/Inbox |
| Identidad | Keycloak, OpenID Connect y Code + PKCE |
| Entorno reproducible | Docker Compose y builds multietapa desde fuentes |

## Uso local

### Entrada operativa de la instalación existente

Con Node.js 22 y Docker Compose, usar los archivos privados ya preparados y autorizados de esta instalación (nunca versionarlos):

~~~sh
node infra/local/run.mjs check --env-file output/stack/cu16-s3.private.env --n8n-env-file output/stack/n8n.private.env
node infra/local/run.mjs status --env-file output/stack/cu16-s3.private.env --n8n-env-file output/stack/n8n.private.env
~~~

La misma entrada acepta up y stop en lugar de check, sólo con autorización para arrancar/parar. Default temporal: cu16-proof; --project selecciona otra instalación existente, no crea otra plataforma. Conserva overrides, volúmenes y credenciales. No prepara perfiles, importa flujos, renueva consentimiento, ejecuta semillas ni migra documentos. Ver guardas y límites en la [guía local](docs/deployment/local-compose.md).

### Demo histórica para una copia nueva, no recuperación con datos

Necesitás Docker con Compose y acceso a internet para descargar imágenes y paquetes. Desde la raíz de una copia del repositorio, ejecutá:

```sh
docker compose --env-file .env.example --profile demo up --build -d
docker compose --env-file .env.example --profile demo ps -a
docker compose --env-file .env.example --profile demo logs --no-log-prefix demo
```

Abrí **http://127.0.0.1:4280** cuando las aplicaciones estén saludables y `demo` termine con código `0`. No necesitás instalar Java, Node.js ni PHP en el host. La primera compilación puede tardar varios minutos.

Las cuentas se generan una sola vez y se conservan en volúmenes privados; no hay contraseñas públicas comunes. La [guía de Docker Compose](docs/deployment/local-compose.md) explica cómo exportarlas en privado, elegir la fecha de los trabajos demo, cambiar el puerto y detener el entorno conservando datos. El perfil `demo` es opcional y explícito: sin él no se crean datos de muestra.

Para detener este entorno sin borrar sus datos:

```sh
docker compose --env-file .env.example stop
```

La configuración pública se separa de las credenciales privadas. No compartas archivos de cuentas ni elimines los volúmenes para reiniciar.

La propuesta para llevar el sistema a proveedores administrados está en [preparación remota y portabilidad](docs/deployment/cloud-portability.md). No representa un despliegue cloud realizado.

## Alcance y próximos módulos

La agenda web, ejecución/finalización y sincronización offline cuentan con evidencia funcional por caso de uso. CU27 verificó PWA y Android físico: preparación sin red, fotos/inferencia local, recuperación de respuestas perdidas sin duplicación y rechazo por permiso conservando evidencia; ver [resultados y límites](docs/evidence/cu27-20261105.md). La comparación visual está diferida.

El asistente y el reporte narrativo (CU25/CU26) están **parciales y publicados**: pregunta con modelo local, aclaración, denegación por permiso, reporte con trabajo asíncrono y exportación, verificados en el navegador real; ver [evidencia y límites](docs/evidence/cu25-cu26-shell-20261106.md). El asistente es todavía un proceso local en *loopback*, no un componente desplegado, y no se declara calidad del modelo.

CU28 verificó **un** flujo por evento real —solicitud de revisión de CU17 hasta el canal local, con reentrega, fallo, recuperación y agotamiento de reintentos—; los otros cuatro flujos acordados siguen pendientes, igual que la programación con identidad técnica y los avisos externos. MCP de consulta (CU29) está integrado contra las APIs reales; CU30/CU31 quedan después.

El modelo visual continúa experimental/no validado: ejecutarlo localmente no acredita calidad diagnóstica ni permiso de redistribución de sus artefactos. La lectura humana de notificaciones y otros recorridos no se declaran terminados por estas pruebas.

## Documentación

[Arquitectura y alcance](docs/context/PROJECT.md) · [Casos de uso](docs/use-cases) · [Contratos](contracts) · [Decisiones técnicas](docs/decisions) · [Evidencia técnica](docs/context/STATUS.md)

La documentación técnica conserva las verificaciones y antecedentes fuera de esta presentación. El [README técnico anterior](docs/archive/README-before-local-compose.md) se conserva como antecedente histórico; sus instrucciones antiguas no reemplazan la guía vigente.

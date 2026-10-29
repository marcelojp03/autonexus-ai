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

La agenda de esta entrega es web y online. La consulta offline, Flutter, el registro de ejecución/finalización, la lectura humana de notificaciones y los módulos de IA y sincronización no se presentan como capacidades terminadas. El nombre del proyecto expresa esa dirección, no una precisión de IA ni un modelo entrenado acreditados.

## Documentación

[Arquitectura y alcance](docs/context/PROJECT.md) · [Casos de uso](docs/use-cases) · [Contratos](contracts) · [Decisiones técnicas](docs/decisions) · [Evidencia técnica](docs/context/STATUS.md)

La documentación técnica conserva las verificaciones y antecedentes fuera de esta presentación. El [README técnico anterior](docs/archive/README-before-local-compose.md) se conserva como antecedente histórico; sus instrucciones antiguas no reemplazan la guía vigente.

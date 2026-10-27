# Línea base vigente
Consolidada el 25 de octubre de 2026 a partir del Notion y del chat final compartido.
## Decisiones acordadas
- Un solo taller; empleados, clientes, vehículos, citas, servicios, órdenes y finanzas.
- Sin inventario, repuestos, venta de productos, sucursales ni administración multiempresa.
- El personal usa la plataforma; el cliente no necesita cuenta propia.
- MS01 Operaciones/Spring Boot/PostgreSQL; MS02 Empleados/NestJS/PostgreSQL; MS03 Finanzas/Laravel/PostgreSQL; MS04 Inteligencia/FastAPI/MongoDB; MS05 Sincronización/NestJS/DynamoDB.
- BFF NestJS y servidor MCP TypeScript son aplicaciones adicionales. MCP externo es independiente de agentes internos.
- MF01 Empleados y MF02 Operaciones en Angular; MF03 Finanzas y MF04 Inteligencia en React; Shell single-spa/PWA; Flutter Android.
- S3 privado para fotografías/evidencias/documentos; bases guardan referencias.
- Keycloak SSO, RabbitMQ/Outbox, Saga de CU15, automatizaciones n8n, reportes generativos, IA local/remota y ML.
- CU01–CU31 conservan su numeración; 3 bloques de 34 puntos estimados, con 11/12/8 CU.
## Recorrido prioritario
Cliente/vehículo → recepción/orden → cotización y decisión del cliente → CU15 reserva horario, vincula cotización y confirma → avances/verificación → cobro/entrega.
## Reparto
El reparto siguiente identifica responsables de referencia y coordinación; no es exclusividad. Cualquier integrante puede implementar bases, dependencias, BFF, microfrontends u otras funcionalidades necesarias para completar un recorrido, incluso de otro bloque. Ver `docs/decisions/009-modelo-trabajo-ramas-y-alcance.md`.
## Bloque 1: operaciones y empleados

Integrante 1: 11 casos y 34 puntos estimados. Responsable del núcleo operativo, Empleados y coordinación de Saga. Establecerá los contratos iniciales del Shell, autenticación y base móvil con colaboración del equipo.

| Código | Caso de uso | Iniciador | Dificultad / puntos |
| --- | --- | --- | --- |
| CU01 | Iniciar sesión | Empleado | Media / 3 |
| CU02 | Administrar roles y permisos | Administrador | Media / 3 |
| CU03 | Gestionar empleados | Administrador | Baja / 2 |
| CU04 | Gestionar horarios y disponibilidad | Administrador / Jefe | Media / 3 |
| CU05 | Consultar agenda de trabajos asignados | Mecánico | Baja / 2 |
| CU10 | Gestionar citas de servicio | Recepcionista | Alta / 4 |
| CU11 | Recepcionar e inspeccionar vehículo | Recepcionista | Media / 3 |
| CU12 | Crear orden de trabajo | Recepcionista | Media / 3 |
| CU15 | Confirmar servicio y asignar mecánico | Jefe de taller | Muy alta / 5 |
| CU16 | Registrar ejecución, avances y evidencias | Mecánico | Alta / 4 |
| CU17 | Verificar y finalizar orden de trabajo | Jefe de taller | Baja / 2 |
|  | TOTAL | Integrante 1 | 34 puntos |

## Bloque 2: clientes, finanzas y offline

Integrante 2: 12 casos y 34 puntos estimados. Responsable de clientes/vehículos, Finanzas, integración de IA local y Sincronización. Consumirá los modelos exportados por el integrante 3 y coordinará contratos GraphQL/REST.

| Código | Caso de uso | Iniciador | Dificultad / puntos |
| --- | --- | --- | --- |
| CU06 | Gestionar clientes | Recepcionista | Baja / 2 |
| CU07 | Gestionar vehículos | Recepcionista | Baja / 2 |
| CU08 | Consultar historial de servicios de un vehículo | Personal autorizado | Baja / 2 |
| CU09 | Gestionar catálogo de servicios automotrices | Administrador | Baja / 2 |
| CU13 | Elaborar cotización de servicio | Responsable financiero | Media / 3 |
| CU14 | Registrar aprobación o rechazo de cotización | Recepcionista | Baja / 2 |
| CU18 | Registrar entrega de vehículo | Recepcionista | Baja / 2 |
| CU19 | Registrar cobro de servicio | Responsable financiero | Media / 3 |
| CU20 | Registrar gastos operativos | Responsable financiero | Baja / 2 |
| CU21 | Consultar indicadores empresariales | Administrador | Alta / 4 |
| CU22 | Realizar inspección visual mediante IA local | Mecánico | Muy alta / 5 |
| CU27 | Sincronizar operaciones realizadas offline | Empleado / reconexión | Muy alta / 5 |
|  | TOTAL | Integrante 2 | 34 puntos |

## Bloque 3: IA, MCP y automatización

Integrante 3: 8 casos y 34 puntos estimados. Responsable de Inteligencia, modelos, agentes internos, MCP independiente, n8n y reportes. Preparará modelos web/móvil y contratos de integración externa.

| Código | Caso de uso | Iniciador | Dificultad / puntos |
| --- | --- | --- | --- |
| CU23 | Analizar imágenes mediante IA del servidor | Mecánico | Muy alta / 5 |
| CU24 | Estimar duración de servicios mediante ML | Jefe de taller | Muy alta / 5 |
| CU25 | Consultar asistente empresarial inteligente | Empleado autorizado | Muy alta / 5 |
| CU26 | Generar reportes inteligentes | Administrador | Alta / 4 |
| CU28 | Ejecutar automatizaciones empresariales | Administrador / n8n | Media / 3 |
| CU29 | Consultar información mediante MCP | Cliente MCP externo | Alta / 4 |
| CU30 | Solicitar operaciones empresariales mediante MCP | Cliente MCP externo | Muy alta / 5 |
| CU31 | Administrar acceso de clientes MCP externos | Administrador | Media / 3 |
|  | TOTAL | Integrante 3 | 34 puntos |


## Fuentes y asuntos pendientes
Git: un único monorepositorio en la raíz `autonexus-ai`, rama inicial `main`, remoto `https://github.com/marcelojp03/autonexus-ai.git`. No inicializar repositorios independientes por aplicación. Versionar fuentes, documentación, lockfiles y `.env.example`; excluir dependencias, builds, secretos y datos locales. Decisión explícita de Marcelo, registrada en `docs/decisions/003-monorepositorio-git.md`.

Notion es la fuente de decisiones funcionales; el repositorio documenta contratos y estado comprobado. Sus copias están en `docs/reference/`. La propuesta antigua de Google Docs es un antecedente con decisiones superadas.
El modelo de dominio y sus estados/cardinalidades son propuestas de revisión, no reglas ya aprobadas. Quedan por definir política de reservas, cancelaciones, reasignación, pagos parciales/entrega, vigencia offline, dataset y detalle de evaluación del docente.
No fijar versiones de frameworks ni contratos de producción sin inicializar y comprobar compatibilidad.

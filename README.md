# AutoNexus AI

Segundo parcial de Ingeniería de Software II · UAGRM · Entrega: 10 de noviembre de 2026.

## Estado

Monorepositorio de AutoNexus AI. El Shell y los microfrontends Angular de Empleados y Operaciones están integrados y verificados localmente. La base técnica backend de Operaciones y Empleados está generada y verificada con PostgreSQL real en feat/backend-foundation, con revisión independiente satisfactoria; las funciones de negocio, Keycloak y CU01 real siguen pendientes. Consultar `docs/context/STATUS.md` para evidencia y límites.

## Primeros pasos

1. Extraer en una carpeta nueva. La carpeta principal es `autonexus-ai`.
2. Abrir esta raíz en el editor y en la terminal del asistente.
3. Leer `AGENTS.md`, `docs/context/PROJECT.md` y `docs/context/STATUS.md`.
4. Copiar el mensaje de `docs/ai/START-HERE.md`; indicar el bloque del integrante.
5. Usar el repositorio Git de esta raíz; no inicializar repositorios separados dentro de las aplicaciones. Trabajar en ramas por tarea/CU y conservar los lockfiles y `.env.example`.
6. Acordar los contratos de CU15 y crear gradualmente los proyectos con sus generadores oficiales, preservando estos archivos.

## Aplicaciones previstas

- `services/operations`: MS01 Operaciones (Spring Boot).
- `services/employees`: MS02 Empleados (NestJS).
- `services/finance`: MS03 Finanzas (PHP/Laravel).
- `services/intelligence`: MS04 Inteligencia (Python/FastAPI).
- `services/sync`: MS05 Sincronización (NestJS).
- `integration/bff`: BFF (NestJS).
- `integration/mcp-server`: MCP independiente (TypeScript + SDK MCP).
- `web/shell`: Shell y PWA (single-spa + TypeScript).
- `web/mf-employees`: MF01 Empleados (Angular).
- `web/mf-operations`: MF02 Operaciones (Angular).
- `web/mf-finance`: MF03 Finanzas (React).
- `web/mf-intelligence`: MF04 Inteligencia (React).
- `mobile/autonexus_app`: Aplicación Android (Flutter).
  Son cinco microservicios y dos aplicaciones backend de integración; cuatro microfrontends y un Shell; una aplicación móvil.

## Contexto

- `AGENTS.md`: instrucciones comunes para la IA.
- `AGENTS.md` dentro de cada aplicación: alcance local.
- `docs/context/PROJECT.md`: decisiones vigentes.
- `docs/context/CONTEXT-MAP.md`: qué leer según la tarea.
- `docs/use-cases/CU01.md` a `CU31.md`: especificaciones completas.
- `docs/reference/`: copias fechadas de Notion.
- `docs/context/STATUS.md`: estado comprobado y siguiente paso.
- `docs/ai/`: instrucciones de arranque, tarea y cierre de sesión.

## Trabajo en equipo

La raíz Git única es `autonexus-ai`. Remoto: https://github.com/marcelojp03/autonexus-ai.git. Las carpetas `.git` de NG-ALAIN copiadas en ambos Angular fueron retiradas con autorización de Marcelo y enviadas a la Papelera; los archivos y cambios de las aplicaciones permanecen intactos. Ver `docs/decisions/003-monorepositorio-git.md`. No se ha hecho push desde esta preparación.

Usar ramas breves por tarea/CU y revisar cambios antes de integrar en main. Los archivos de contexto se versionan con el código. Las decisiones funcionales se registran en Notion; mantener sus copias locales sincronizadas y reportar discrepancias.
Notion: https://app.notion.com/p/4032585d73c181a4acc5f95647d44de4?pvs=204

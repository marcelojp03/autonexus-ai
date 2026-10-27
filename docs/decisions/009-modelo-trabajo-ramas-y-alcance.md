# 009 — Ramas personales, integración frecuente y alcance no exclusivo

Fecha: 2026-10-26. Decisión explícita de Marcelo, registrada en Notion y transmitida al equipo.

## Organización Git

- `main` es la rama de integración y la versión comprobada del equipo.
- Cada integrante usa una rama personal reutilizable: `work/marcelo`, `work/participante-2`, `work/participante-3`.
- No se crea una rama ni un worktree por caso de uso. Las ramas personales se reutilizan entre CU.
- Cada integrante actualiza desde `main` con frecuencia e integra sus entregas verificadas; no se acumula el parcial completo en ramas separadas.
- Las ramas y worktrees existentes (`feat/backend-foundation`, `feat/cu01-keycloak`, `feat/cu03-employees`) se conservan como historia; no se eliminan automáticamente.

## Alcance por participante

- El reparto por CU identifica responsables de referencia y sirve para coordinar, no para limitar qué código se puede tocar.
- Cualquier integrante puede implementar bases, dependencias, BFF, microfrontends u otras funcionalidades de otro bloque cuando sean necesarias para avanzar o completar un recorrido.
- Se mantiene la coordinación cuando dos personas trabajan sobre los mismos archivos, la preservación de cambios ajenos y el registro de lo implementado para evitar duplicaciones.
- No cambian las reglas técnicas: cada servicio mantiene su base, contratos versionados, autorización en servidor, S3 privado y ausencia de credenciales en el repositorio.

## Consecuencias

- Queda autorizada la implementación del BFF y de las pantallas de Empleados para completar CU03 web sin esperar al participante 2.
- La entrega de CU03 se divide en backend (ya entregado) e interfaz más BFF; ninguna de las dos se declara "CU03 completo de punta a punta" por separado.
- Los documentos que presentaban el BFF o los microfrontends como exclusivos de otro participante se actualizan; el reparto se conserva como referencia de responsabilidad.
- La verificación se mantiene proporcional: primero lo afectado, smoke del conjunto y suites amplias solo ante cambios de contrato, regresiones o motivo concreto.

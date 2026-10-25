# 001 — Conservar y verificar la base Angular de los templates

Fecha: 2026-10-25.
Estado: aplicada para esta verificación local por instrucción de Marcelo; no constituye acuerdo de contratos de producción del equipo.

## Contexto

Marcelo, participante 1, copió NG-ALAIN 22.1.1 en MF01 Empleados y MF02 Operaciones. Ambos proyectos declaran Angular ^22.2.0, NG-ZORRO ^22.1.1 y pnpm@12.6.0, pero no traen lockfiles. Angular CLI configuraba Yarn. Node activo 22.14.0 no cumple el engine de Angular 22.2. El .nvmrc recomienda 24.20.0.

## Decisión acotada

- Conservar package.json, .nvmrc, diseño, rutas, mocks y autenticación demo; investigar antes de modificar dependencias. No implementar Shell ni CU en esta tarea.
- Verificar con Node 22.22.3 ya disponible, aislado por proceso, y pnpm 12.6.0 exacto. No cambiar herramientas globales. Invocar bin/pnpm.mjs directamente porque los launchers instalados de pnpm 11/Corepack 0.31.0 no resuelven correctamente el nuevo paquete pnpm 12.
- Generar un pnpm-lock.yaml por app y permitir versionarlo; comprobar luego instalación frozen. Respetar los rangos originales: las resoluciones patch no cambian la línea base declarada.
- Alinear cli.packageManager con pnpm. Declarar allowBuilds.plyr=false tras inspeccionar el preinstall de plyr@3.8.5 (solo exige pnpm; distribución ya construida), sin ampliar la aprobación de scripts.
- Mantener los repositorios Git independientes copiados, sus ramas master y los cambios locales previos. La organización Git global queda pendiente.

## Consecuencias y evidencia

Instalación frozen y builds producción con código 0 en ambas apps; HTTP 200 en 4201/4202 y smoke login demo → dashboard. Permanecen avisos de bundle de 2,48 MB, CommonJS y Husky deprecado. No se acredita integración de backend, SSO ni CU01. Ver READMEs locales y docs/context/STATUS.md para comandos, versiones resueltas, tiempos y límites.

## CU y contratos afectados

Preparación técnica de MF01 (CU01–CU05) y MF02 (CU06–CU12, CU15–CU17 y funcionalidades compartidas según reparto). Ningún contrato ni regla funcional se cambia. El alcance de esta nota no declara implementados esos CU.

La futura propiedad del layout, sesión Keycloak, refresh, routing/prefijos, assets y lifecycles single-spa sigue siendo propuesta pendiente de acuerdo. No se adopta como contrato del equipo.

Fuente de la instrucción: solicitud de Marcelo en esta sesión. No se proporcionó enlace específico de Notion para esta verificación; no se inventa uno.

Actualización posterior: la decisión 002 unifica .nvmrc en Node 22.22.3 e implementa la composición local del Shell solicitada después por Marcelo. Esta nota conserva la evidencia histórica de la primera verificación; sus propuestas de integración ya no describen el estado actual.

# 003 — Un único monorepositorio Git

Fecha: 2026-10-25. Estado: aceptada por instrucción explícita de Marcelo.

## Decisión

La raíz Git de todo AutoNexus AI es `autonexus-ai`, con rama inicial `main` y remoto `origin` apuntando a `https://github.com/marcelojp03/autonexus-ai.git`. No se crearán repositorios separados por aplicación. Las ramas de tarea y los worktrees comparten ese repositorio; no son nuevos repositorios de aplicación. No se hará push ni publicación sin autorización.

## Inspección y conservación

La raíz no tenía `.git`. Ambos Angular sí tenían repositorios independientes en `master`, commit `58a5297f`, con origin `https://github.com/ng-alain/ng-alain.git`. Se comprobó que no eran worktrees ni pertenecían al monorepo. Marcelo autorizó retirarlos si eran ajenos. Se enviaron exclusivamente `web/mf-employees/.git` y `web/mf-operations/.git` a la Papelera de Windows, por lo que sus metadatos son recuperables. No se retiraron archivos fuente, lockfiles, AGENTS ni cambios de las aplicaciones. Ambos `git rev-parse --show-toplevel` ahora resuelven la raíz AutoNexus.

El remoto informado respondió sin ramas durante la inspección de solo lectura. Se configura localmente, sin push ni modificación del repositorio remoto. La línea base local incluye el estado de frontend ya verificado, no una implementación de backend ni de CU.

## Archivos incluidos y excluidos

El `.gitignore` conserva sus reglas previas y excluye dependencias, builds/cachés, pruebas/capturas generadas, worktrees, archivos `.env`, claves/certificados privados, dumps, volúmenes y datos locales. Conserva lockfiles, ejemplos `.env.example` y Maven Wrapper. Se verificó que los tres lockfiles pnpm existentes no estén ignorados y que sí se ignoren rutas de entorno real y artefactos. El examen de candidatos antes de la línea base no detectó archivos generados/entornos indebidos ni patrones de alta confianza de claves privadas/tokens; no constituye una auditoría exhaustiva de secretos.

## Consecuencias

Los Angular deben incorporarse como archivos normales, nunca como entradas gitlink/submódulo. Los README y STATUS de tareas anteriores contienen evidencia histórica de la estructura previa; esta decisión establece la organización vigente. Las bases PostgreSQL y las credenciales seguirán siendo locales y excluidas de Git.

Fuente: instrucciones explícitas de Marcelo en esta sesión. No se proporcionó enlace de Notion para esta decisión.

# CU29 — MCP de consulta verificado; n8n importado sin ejecutar

Rama `work/marcelo`, entrega `a0f34d5`. Base `8bb0ca9` (CU27 publicado). Leer
`docs/evidence/cu29-20261105.md` y `docs/compose/spec/mcp-read-n8n.md`.

## Qué quedó en pie

- MCP independiente en `integration/mcp-server` (TypeScript, SDK oficial v2 2.4.0) con seis
  consultas GET: órdenes, agenda propia/equipo y ejecución propia/equipo. Sin base de negocio.
- Token propio con pareja de audiencias exacta; exchange estándar de Keycloak hacia
  Operaciones/Empleados con el mismo `sub`; el token MCP nunca viaja al propietario.
- Proyección con allowlist (sin PII, precios, notas, archivos ni URLs); 401/403/404/503 nunca
  se convierten en lista vacía.
- Clientes locales (`autonexus-mcp-server`, `autonexus-mcp-local-reader`, `autonexus-n8n-reader`)
  y roles de lectura `mcp_read_self`/`mcp_read_team` creados por API del propietario, con
  verificación previa de que el usuario ya tenía esos permisos. Sin rotar secretos.
- n8n `2.46.6` fijado por digest, contenedor local healthy y workflow manual importado e
  **inactivo**.

## Verificación observada

`pnpm test` 84/84; pruebas de aprovisionamiento 27/27; integración real **10 etapas PASS**
(Keycloak + Operaciones), incluidos órdenes y agenda reales sin campos privados, ejecución de
equipo paginada, registro inexistente 404 como error y mecánico denegado por scope.

## Pendiente y límites

1. **Ejecución real de n8n**: falta el primer consentimiento OAuth2 del cliente confidencial en
   el navegador; después crear la credencial, fijar su `id` en el JSON exportado y ejecutar el
   flujo manual. No se acredita hasta entonces.
2. **CU28 parcial**: sin avisos, sin disparadores por evento y sin programación con identidad
   técnica. Los contratos exigen empleado activo vinculado para agenda/ejecuciones; no se abre
   excepción para una cuenta de máquina.
3. **CU31** sin implementar (sin CRUD web de clientes; el registro local es configuración).
4. Sin CU30 (escrituras), sin despliegue cloud y sin verificación de ACL de Windows.

## Próximo paso

Ejecutar el flujo n8n con el consentimiento del usuario y, si se autoriza, continuar con el
resto del bloque MCP (CU30/CU31) o con CU25 sin MCP.

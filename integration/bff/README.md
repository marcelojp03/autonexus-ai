# BFF
Tecnología prevista: NestJS.
Persistencia: Sin base de negocio.
Responsabilidad: Bloque 2; contratos compartidos.
Alcance: GraphQL empresarial, composición por APIs y adaptación del acceso móvil REST. Nunca consultar directamente las bases propietarias.
## Estado

CU03 está integrado localmente en main y su REST propietario sirve127.0.0.1:3002 desde raíz. Traspaso exacto de OpenAPI/SDL/auth, operaciones/errores/comandos e invariantes operationId/expectedVersion/access.status: docs/handoffs/2026-10-26-cu03-main-cu04.md (ruta desde raíz). Este backend entregado NO convierte el BFF reservado ni mf-employees en integración web terminada. No copiar credenciales IdP ni sustituir usuario por cuenta técnica.

CU03 ya tiene backend propietario verificado en feat/cu03-employees. Contratos tempranos: contracts/rest/employees.openapi.yaml, contracts/graphql/employees.graphql y contracts/auth/employees.md (rutas desde raíz), publicados en12f44e6 antes de implementar. Implementar aquí los resolvers y validación por operación/campo/registro sigue a cargo del participante2; no hay conexión SQL ni credenciales IdP en BFF. Validar sesión y propagar bearer autorizado para audiencia Empleados; audiencia propia/mappers/exchange pendientes de acuerdo. El SDL es propuesta, no integración ejecutable. No conectar mf-employees directamente a REST ni reemplazar usuario por cuenta técnica administrativa.
Carpeta reservada. Aplicación todavía no generada. Leer el AGENTS raíz y local antes de inicializar. Los comandos para instalar, ejecutar y verificar se añadirán después de comprobarlos en el proyecto real.


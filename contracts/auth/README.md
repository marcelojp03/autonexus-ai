# Contrato local CU01

Especificación aprobada: docs/compose/spec/cu01-keycloak.md. Este contrato versiona composición de sesión, claims y recursos técnicos; no contiene lógica de dominio/ORM ni implementa CU02.

Issuer exacto local: http://127.0.0.1:8180/realms/autonexus. Firmas RS256 con JWKS confiable del realm; exp obligatorio y tolerancia5s. Audiencias propias: autonexus-operations-api y autonexus-employees-api. Access tokens con ambas audiencias desde clientes públicos PKCE; IDtokens no reciben audiencias API. Roles realm: administrador,recepcionista,mecanico,jefe_taller,responsable_financiero; no se infiere herencia empresarial.

GET /technical/session exige JWT válido y algún rol reconocido; respuesta {resource:'session',service,subject,roles}. GET /technical/admin exige administrador y devuelve {resource:'admin',service,authorized:true}. Son pruebas técnicas, no consultas/CRUD del taller ni CU02. Sin bearer o inválido→401; válido sin permiso→403, cuerpos genéricos sin token/detalles. Salud permanece pública.

session.ts es un contrato de tipos puro. El Shell integrado es propietario de la única sesión/renovación y entrega SessionPort; no entrega JWT, IDtoken ni refresh token en props. Los MFs leen snapshot, se suscriben y solicitan únicamente diagnósticos por destinos allowlisted. Desmontar un MF no cierra ni destruye sesión global. Standalone OIDC crea un propietario local explícito; demo no obtiene tokens ni llama APIs protegidas. Ausencia de puerto integrado no activa demo.

Los tokens se mantienen en memoria. El adapter oficial gestiona estado/nonce/verificador PKCE transitorios de callback; el retorno interno validado es metadata no secreta. Nunca copiar JWT a Delon/localStorage/sessionStorage ni imprimir valores/Authorization.

Logout termina sesión/renovación IdP y estado cliente. JWT ya emitido puede seguir válido hasta exp+5s con verificación offline; no se promete revocación instantánea.

## Frontera BFF

Funciones empresariales web se implementarán en GraphQL mediante integration/bff (participante2), mientras servicios conservan REST. No se crea BFF ni una simulación en esta entrega. Para el futuro BFF se requiere acordar audiencia propia/mappers, validación de issuer/firma/exp, forwarding o exchange autorizado y políticas rol/acción/registro por campo/CU. Este contrato técnico no reemplaza esos esquemas empresariales ni acredita su integración.

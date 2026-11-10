# 036 — Entrada web orientada al trabajo del usuario

Fecha: 2026-11-10.

Estado: aplicada en esta copia y en su web local por solicitud del usuario; sin publicación Git ni cambio de contrato empresarial.

## Contexto

La portada integrada repetía el estado OIDC, UUID, comprobaciones REST y avisos del template en
pantallas empresariales. Un jefe con permisos de agenda propia y de equipo entraba por defecto
a su agenda individual. Esto confundía la disponibilidad técnica con la experiencia del taller.

## Decisión

- El Shell presenta el rol con una etiqueta legible, conserva un único cierre de sesión y resalta
  la página seleccionada. No inventa un nombre personal: SessionIdentity no ofrece ese campo.
- Empleados y Operaciones integrados no repiten SessionControls ni el título/aviso del template.
  Las pantallas standalone y sus controles no se cambian.
- La entrada de Empleados preserva administración de personal cuando tiene su permiso; después
  prioriza agenda del equipo sobre propia. Sin esos permisos dirige al asistente, que reautoriza
  sus herramientas. Shell y ruta interna se contrastan en pruebas de paridad.
- Se retiran Widgets/Panel demo de la navegación habitual. Las rutas de desarrollo conservan
  su aviso explícito; las comprobaciones técnicas del Shell requieren `?diagnostics=1` y la
  presentación de `security:read`, además de la autorización efectiva de cada API.
- El módulo restringido se oculta cuando su resolución de permisos indica forbidden. Esto es
  presentación: no sustituye firma, permisos o autorización por registro en el servidor.
- Cabecera, sesión y contenedores reciben jerarquía visual y adaptación de tamaños sin indicadores
  inventados ni consultas de métricas nuevas.

## Verificación y límites

36 pruebas Node de navegación, paridad de entradas, sesión, configuración y router integrado,
sin fallos. Build Docker web completo con Angular, React, Shell/TypeScript y manifiesto offline,
exit 0. Se sustituyó únicamente web mediante el overlay local existente.

Chrome aislado, login real de jefe y mecánico, consultas del 2026-11-17: capturas a 1440×1000
y 390×1000 inspeccionadas como imágenes. Entradas respectivas en agenda de equipo/propia,
sección activa, sin panel técnico duplicado ni enlaces demo, sin overflow del documento ni
excepciones no controladas observadas. Cero mutaciones GraphQL durante el recorrido. El primer
verificador esperaba erróneamente una parada anónima en una ruta protegida; se ajustó al redirect
directo a Keycloak existente antes de repetir con éxito. No se cambió la autenticación para ello.

Capturas, reporte y verificador quedan ignorados en `output/ui-review/`; perfiles de prueba
aislados de la sesión del usuario. No se registraron trabajos, cobros ni cambios de permisos.
Las pruebas sintéticas no se presentan como evidencia de integración: el recorrido de navegador
usa la instalación real y cuentas demo existentes.

Alcance visual: cabecera/entrada y agenda de ambos perfiles, no todas las pantallas. La tabla
conserva desplazamiento horizontal interno en móvil y texto empresarial heredado. No se
declara rediseño global, aceptación nueva de CU, calidad del modelo ni recuperación de Sync/S3.

CU relacionados: CU01, CU05; presentación de CU03 y Operaciones. Contratos sin cambios:
`contracts/auth/session.ts`, permisos efectivos y API/BFF existentes.

Fuente: solicitud y captura del usuario en la conversación; sin enlace Notion propio. Esta nota
registra el incremento local, no una nueva regla de negocio aprobada por el equipo.

## Corrección de actualización del módulo (2026-11-10)

Una captura posterior mostró Shell nuevo junto al panel antiguo de Empleados tras F5.
Las entradas remotas mantenían `main.js` sin versión y Nginx no exigía revalidación.
El Shell ahora importa las entradas con un digest de los cuatro main.js preparados durante
el build; los chunks importados ya llevan hash. Nginx usa `location ^~ /mfs/` y `no-cache`
para que su regla de extensiones no anule la revalidación. Desarrollo/preview también
revalidan los recursos del módulo. No se borra almacenamiento, colas ni service workers.

Build web y Nginx válidos; 36/36 pruebas Node. Imagen local `87c9b92da571` aplicada solo a web.
HTTP comprobado: entrada 200 con `Cache-Control: no-cache`, Shell con URL versionada.
Verificador Chrome real ampliado para exigir digest en la petición y ausencia del aviso antiguo.
La primera ejecución de Chrome restringida falló al conectar con su depurador; se repitió
con ejecución autorizada y perfil aislado. No se inspeccionó el perfil personal del usuario;
la mezcla observada es compatible con caché antigua, sin atribuirla a un almacén concreto.

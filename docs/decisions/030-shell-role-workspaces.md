# 030 — Espacios web derivados de permisos efectivos

**Estado:** aplicado en `work/nelson`, pendiente de verificación integrada y revisión. No integrado ni publicado.

## Decisión

La raíz web es una puerta de entrada SSO: una visita anónima comienza Keycloak; después de autenticar, la Shell solicita `securityCatalog.effective` al BFF. Una sola aplicación con destino permitido abre directamente; varias aplicaciones permitidas muestran selector de espacios; ninguna o una consulta fallida no exponen MFEs. El destino de retorno sólo admite rutas internas validadas.

Los permisos efectivos resueltos por servidor, y no los nombres de roles del token, determinan presentación y navegación. Los guards de ruta de cada MFE vuelven a comprobar permisos efectivos; cada campo BFF y API propietaria conserva su autorización y alcance por registro. Una lista o un guard del navegador no reemplaza la autorización del servidor. Los permisos se vuelven a consultar durante la sesión, teniendo presente el TTL documentado de caché de propietarios.

## Consecuencias

- Los espacios son destinos laborales independientes, no una secuencia obligatoria.
- Deep-links sin permiso regresan al selector o al único destino permitido; la carga de permisos falla cerrada.
- Empleados y Operaciones enrutan sus entradas a una vista real soportada por los permisos actuales.
- La app Flutter continúa como ruta de servicio del mecánico, con cola offline visible y sin flujo de cuenta de cliente.
- No se declaran cerrados CU ni se infiere autorización desde permisos UI, roles laborales, ni datos demo.

## Verificación pendiente

Consultar `docs/context/STATUS.md` para comandos, resultados y bloqueos concretos de este delta.

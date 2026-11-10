# 040 — Preparar EC2 antes de desplegar la aplicación

Fecha: 2026-11-10. Instalación en la instancia del usuario expresamente autorizada.

Se prepara Ubuntu 24.04 amd64 con Docker Engine, CLI, Buildx y Compose desde el
repositorio oficial de Docker; Nginx y Certbot/plugin desde Ubuntu, más utilidades
de descarga/diagnóstico/Git. No se instalan entornos de desarrollo de cada servicio
en el host, porque las imágenes del monorepositorio ya los encapsulan.

Se conserva un script revisable en `infra/ec2/prepare-host.sh` y registro de versiones
en su README. La instalación configura arranque automático de Docker/Nginx y timer
Certbot; `ubuntu` puede operar Docker después de reconectar, como usuario con sudo.
Sin modificación de recursos AWS, claves S3, DNS ni datos del entorno local.

Verificación real: instalación exit0, hello-world, nginx -t, HTTP200 local y externo,
servicios activos/habilitados, Docker sin sudo en nueva sesión y dpkg sin paquetes
pendientes de configuración. Únicos listeners públicos observados: SSH22 y HTTP80.

No se emiten certificados ni se despliega AutoNexus en esta etapa. Los dominios
todavía no resolvían a la IP de EC2 al comprobarlos; el HTTP200 es Nginx predeterminado.
Se requiere luego DNS correcto, HTTPS/proxy, origen/identidad coherentes, rol S3 y
verificación integral del stack. No se acredita ningún CU por preparar el host.

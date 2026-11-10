# Preparación del host EC2

`prepare-host.sh` instala prerrequisitos en Ubuntu 24.04 amd64 con autorización del
propietario. Ejecutar como root (`sudo bash prepare-host.sh`). No instala la aplicación,
no copia secretos, no cambia grupos de seguridad ni emite certificados.

Docker procede de su [repositorio oficial](https://docs.docker.com/engine/install/ubuntu/).
Nginx, Git, curl, jq, unzip y Certbot con su plugin Nginx proceden de Ubuntu.
El script selecciona el candidato estable de Docker y fija esa versión para Engine
y CLI en la instalación; no reproduce una versión histórica automáticamente.
Comprueba contenedor hello-world, configuración Nginx y respuesta HTTP local.
Habilita Docker/Nginx al iniciar el host y el temporizador de renovación Certbot.
Añade `ubuntu` al grupo docker, con autoridad equivalente a root sobre el host;
el cambio aplica en una nueva sesión SSH.

## Instalación comprobada el 2026-11-10

Ubuntu 24.04.5 LTS x86_64, instancia t3.large, raíz gp3 de 30 GiB cifrada.

| Herramienta | Versión instalada |
| --- | --- |
| Docker Engine / CLI | 29.9.3 (`5:29.9.3-1~ubuntu.24.04~noble`) |
| Compose | 5.7.0 |
| Buildx | 0.38.1 |
| containerd | 2.4.2 |
| Nginx | 1.24.0 (`1.24.0-2ubuntu7.19`) |
| Certbot / plugin Nginx | 2.9.0 |
| Git | 2.43.0 (`1:2.43.0-1ubuntu7.4`) |

Instalación exit0, hello-world PASS, `nginx -t` PASS, servicios activos/habilitados,
HTTP local y público 200, `dpkg --audit` sin pendientes y Docker sin sudo en sesión
nueva PASS. Raíz: 2,7 GiB usados, ~26 GiB disponibles. No se reinició la instancia.

## Lo que falta para desplegar AutoNexus

- Ambos dominios deben resolver a la IP de la instancia. La consulta de esta
  comprobación todavía resolvía a otras IP; no se intentó emitir certificados.
- Preparar virtual host/proxy y HTTPS. El HTTP200 actual es la página predeterminada
  de Nginx: no es la aplicación ni una comprobación del proyecto.
- Descargar `work/gabriel`, preparar PUBLIC_ORIGIN/Keycloak/issuer/callbacks, construir
  las imágenes y crear los volúmenes del entorno EC2. Mantener APIs/bases internas.
- Asociar rol de instancia para S3 sobre `evidence/*` y añadir origen HTTPS a CORS.
  No copiar claves personales de Windows ni asumir que ya hay rol IAM asociado.
- Verificar inicio de sesión, permisos, persistencia, evidencia y análisis en el
  entorno desplegado. El modelo sigue experimental.

Las herramientas de Node/PHP/Java/TensorFlow se instalan en las imágenes del proyecto;
no hace falta instalar esos entornos de ejecución globalmente en el host.

# 039 — S3 local con identidad propia y montaje privado

Fecha: 2026-11-10. Configuración del entorno local solicitada por el usuario.

El usuario creó el bucket `autonexus-evidencias-ai` en `us-east-1`, conservando
privacidad, y configuró CORS para el origen local. Creó un usuario IAM dedicado
con PutObject/GetObject/DeleteObject limitados a `evidence/*`, sin acceso de consola.

El CSV de Downloads se importa sin mostrar secretos a un archivo dentro de
`output/local/`, excluido de Git y del contexto Docker. No se modifica el CSV ni
se sobrescriben perfiles AWS del usuario. Un override local conservando el ajuste
CU28 existente monta el archivo readonly solo en Operaciones y fija perfil/ruta.
No se incluyen claves en `.env.example`, imágenes, documentación ni entorno Compose.
El archivo de credenciales sigue siendo secreto local y no debe compartirse.

Verificación: configuración Compose válida, consumidor único comprobado, Operaciones
healthy. AWS real: CORS, PUT condicional con checksum, HEAD/tamaño, GET idéntico,
CORS descarga y rechazo de lectura anónima; objeto temporal propio eliminado.
No se alteran registros empresariales ni recursos IAM/CORS durante las pruebas.
No se declara aceptación integral de CU16/CU23 por esta comprobación directa.

Reanudación del mismo entorno:

```powershell
docker compose --env-file .env.example -f compose.yaml -f output/local/runtime.compose.yaml up -d
```

El override y las credenciales son locales y no viajan con Git. Para EC2 se usará
un rol de instancia con permisos de objeto mínimos, sin copiar estas claves; el
origen HTTPS de despliegue deberá incluirse explícitamente en CORS.

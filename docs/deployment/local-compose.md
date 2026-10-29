# Entorno local integral con Docker Compose

Guía técnica en preparación; todavía no acredita arranque, demo ni aceptación integral. La portada no contiene estados históricos ni instrucciones para agentes.

## Configuración validada

Docker29.9.2 y Compose5.6.0 observados. La entrada raíz usa un nombre de proyecto configurable, volúmenes por proyecto y publica solo la web en loopback. No requiere dependencias ni builds del host para sus recetas.

Comprobación ejecutada desde raíz:

```sh
docker compose -p autonexus-t25-proof config --quiet
```

Resultado observado: salida0. Las tres pruebas de configuración comprueban exposición, aislamiento por consumidor y dependencias de migraciones/workers. Esto no prueba todavía el arranque de las aplicaciones.

## Aceptación en curso

Fuente e1e1db8 archivada con Git y extraída sin .git, .env reales, node_modules, vendor, target ni dist. Primer build en proyecto autonexus-t25-proof y puerto4288; solo se documentarán los comandos de uso al observarlos funcionar. No se detuvieron ni modificaron recursos previos.

No ejecutar down -v, volume rm ni prune. Las credenciales del nuevo entorno se generan una vez en volúmenes privados; los entornos históricos no se reutilizan ni migran implícitamente.

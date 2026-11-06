# 026 — Reporte CU26 como trabajo asíncrono con identificador del cliente

Fecha: 2026-11-06. Rama `work/marcelo`. Alcance: `integration/agent` (servicio del asistente),
`contracts/graphql/assistant.graphql`, `integration/bff` y `web/mf-employees`.

## Contexto

El reporte narrativo de un período tarda minutos: la agregación consulta la agenda del taller y una
ejecución por trabajo, y después el modelo local redacta. Medido el 2026-11-06: 20–93 s por reporte en
esta máquina. La llamada síncrona no encaja con dos cortes ya existentes — 120 s del BFF y 15 s de
`SessionPort` en el Shell — y una recarga de la página perdía el resultado.

## Decisiones

1. **El trabajo es la unidad, y su identificador lo genera el cliente.** `startOperationsReport(from,
   to, operationId)` crea el trabajo y responde en milisegundos; `operationsReportJob(jobId)` publica el
   estado y, cuando termina, el documento. Repetir la creación con el mismo `operationId` devuelve el
   mismo trabajo: un doble clic o un reintento de red no generan dos veces.
2. **La interfaz guarda el identificador, no el resultado.** Lo deja en `sessionStorage` bajo una clave
   propia de la pestaña y, al recargar, retoma el sondeo de ese identificador. El trabajo no se vuelve a
   pedir; la recarga no lo duplica.
3. **Durabilidad explícita y acotada.** El documento terminado se escribe en disco (un JSON por trabajo,
   escritura atómica, permisos 0600, retención de 50). El token del usuario **no** se persiste, así que
   un trabajo interrumpido por un reinicio se cierra como `INTERRUPTED` y no se reanuda: no se declara
   durabilidad de lo que solo existe en memoria.
4. **Una autorización vencida no se reintenta sola.** Si el propietario rechaza el token durante la
   generación, el trabajo termina con `AUTHORIZATION_EXPIRED`; volver a generar es una decisión del
   lector, con un `operationId` nuevo. Reintentar el mismo token gastaría lecturas del taller en algo que
   ya falló.
5. **Cada acceso verifica identidad y pertenencia.** Toda consulta del trabajo exige un token válido con
   rol de lectura y que el trabajo pertenezca a esa cuenta; un identificador ajeno responde igual que uno
   inexistente (404), para no confirmar su existencia. La sesión (y su renovación) siguen en el Shell: el
   BFF nunca recibe el refresh token.
6. **Sin infraestructura nueva.** El trabajo corre en el mismo proceso del asistente, con concurrencia 1
   y cola acotada. Una cola llena responde 503 `QUEUE_FULL` en lugar de aceptar trabajo que no puede
   ejecutar. No se agregó microservicio ni plataforma de colas porque el proceso existente alcanza.
7. **Los estados son un autómata, no campos opcionales.** El BFF publica `QUEUED`, `RUNNING`,
   `SUCCEEDED`, `FAILED` o `INTERRUPTED`, y el estado decide qué campos pueden aparecer: `SUCCEEDED` trae
   el documento y ningún código; `FAILED`/`INTERRUPTED` traen código y mensaje propios del BFF y ningún
   documento. Un estado que contradice sus campos se rechaza (falla cerrado) en vez de publicarse.
8. **El código de término lo traduce el BFF.** El servicio puede publicar códigos nuevos; el BFF solo
   deja salir los que conoce y mapea el resto a `INTERNAL_ERROR`, con un mensaje escrito de su lado: el
   texto del propietario no se reenvía a la interfaz.

## Consecuencias

- El flujo del reporte deja de depender de los cortes de 120 s y 15 s, y la recarga es segura.
- El trabajo en curso no sobrevive a un reinicio del servicio; se informa como `INTERRUPTED`.
- La generación real por modelo se midió con `think:false` (20 s) frente a la traza activa (99 s y
  contenido vacío); el verificador de cifras sigue siendo la única puerta de publicación.
- CU25/CU26 siguen parciales: el asistente es un proceso local y CU28 conserva sus otros flujos.

# CU28 — destinatario local inexistente y conciliación funcional

Base `24f76a9`, rama `work/marcelo`. Continúa la aceptación del catálogo en
`cu28-catalogue-20261107.md`, sin repetir su matriz de transporte. Fuente:
`docs/use-cases/CU28.md` (ocho pasos y siete excepciones). Sin mensajes externos.

## Resultado observado

Se reutilizó el sobre real `04283e90-9b95-3dc6-bffe-6c474ca9b2e6`,
`operations.order.finalized.v1`, contra el receptor autenticado ya desplegado. El destino
es un ID del registro local, **no una dirección de cliente ni una URL arbitraria**.

| Petición | HTTP y resultado empresarial | Efecto |
| --- | --- | --- |
| `workshop`, calentamiento | 200 `duplicate`, entrega histórica de 05:20:03.914Z | No entrega nueva |
| `never-existed-cu28`, primer intento | 404 `CU28_RECIPIENT_NOT_FOUND` | Sin registro ni marca de entrega |
| Mismo destino/evento, segundo intento | 404 `CU28_RECIPIENT_NOT_FOUND` | Sigue siendo fallo, no duplicate exitoso |
| `workshop`, repetición final | 200 `duplicate`, misma fecha histórica | No entrega nueva |

Auditoría durable leída del staticData: dos entradas a 23:16:45.087Z y 23:16:46.811Z,
limitadas a `at`, `destinationId`, `eventId`, `result`. Ambas registran el rechazo.
No existe clave delivered para el destino inexistente; las claves históricas permanecen.
Las ejecuciones nativas 708–711 terminaron `success`: significa que el workflow completó
su tratamiento, **no que el destinatario recibió un mensaje**.

Comparaciones inicial/final:

- Canal: **16 registros, 17.530 bytes**, SHA-256
  `a444d71bdfc8d695666a9321d6dfe913f41f33f26788029b32d60eb4e08bcc9f`, bytes idénticos.
- Orden autenticada: `completed`, versión **4**, DTO completo idéntico.
- Outbox histórico: `attempts=1`, entrega anterior conservada, hash de fila
  `f7409fcd945e8ed3c49c0ab2fa7a913c`, idéntico. Su aggregateVersion histórico **28**
  no se corrigió a 4: la corrección del productor rige para eventos futuros.
- Receptor activo; ninguna copia Proof/Fixture activa. Cero escrituras de negocio/Outbox,
  cambios de roles/credenciales o reejecuciones de la reparación.

## Conciliación de requisitos

| Paso CU28 | Evidencia reutilizada o nueva |
| --- | --- |
| 1. Habilitar automatización | Catálogo: importación/activación real y cierre con tres horarios normales activos y copias Proof deshabilitadas |
| 2. Registrar evento empresarial | Catálogo: APIs reales y Outbox propios de asignación definitiva, cita y cotización; orden finalizada en evidencia anterior |
| 3. Publicar evento | `cu28-20261106.md`: commit productor, lease, envío HTTP/1.1, ACK y recuperación por eventId |
| 4. Evento autenticado o programación | Catálogo: tres ejecuciones reales `mode=trigger`, credencial de empleado limitado; receptor autentica secreto |
| 5. Condiciones | Saga global confirmed; cita vigente/mañana civil; cotización todavía pending tras plazo; semana anterior America/La_Paz |
| 6. Acción autorizada | Cinco flujos entregados al canal local; resumen solicita CU26 y preserva documento, fuentes y rotulado |
| 7. Resultado | Outbox delivered/suppressed/abandoned, ledger semanal y resultados nativos; aquí rechazo empresarial separado de success del motor |
| 8. Seguimiento/auditoría | Intenciones e IDs conservados, auditoría de rechazo durable y comparaciones previas/posteriores |

| Excepción CU28 | Evidencia |
| --- | --- |
| Flujo deshabilitado | Catálogo: copias Proof active=0 y ausencia de nuevos disparos por más de un intervalo |
| Credenciales inválidas | Transporte anterior: secreto incorrecto 401; catálogo: sesión delegada expirada falla cerrada |
| Evento duplicado | Transporte/catálogo: un efecto por eventId; aquí dos duplicate reales del destino válido sin líneas nuevas |
| Servicio no disponible | Canal caído, agotamiento y recuperación con el mismo ID; no revertir negocio |
| Error de ejecución | Semana fallida con intención durable, recuperación tras reinicio/cambio de semana (F2 en catálogo) |
| Destinatario inexistente | Dos 404 reales de esta aceptación, auditoría sin delivered ni efecto |
| Falta de permisos | Reautorización del empleado por propietarios; revocación/expiración y restablecimiento en catálogo, F1 del agente |

## Comandos, intentos y límites

Node **22.22.3**, desde el worktree:

```text
node --test scripts/cu28/destination.test.mjs
node output/cu28/catalogue/recipient-missing-resume.mjs
```

Primer comando: **5/5**, HTTP/archivo reales temporales y código embebido del receptor
en VM (no sustituyen la aceptación n8n). Segundo: **exit 0**, `pass=true` en
`output/cu28/catalogue/recipient-missing-real.json`; launcher
`output/cu27/cu28-recipient-resume-checked.{log,exit}`. Artefactos ignorados, no secretos.

Bloqueos previos conservados en el informe: n8n tardó aproximadamente cinco minutos en
arrancar; después se detectó canal detenido. Se restauró sólo el canal sobre el mismo JSONL.
El resume no reimportó ni reinició servicios. Un intento con Node 22.14 falló antes de
enviar y otro se detuvo en autenticación inicial; ninguno se cuenta como aceptación.

Esto acredita el alcance funcional **local configurado** de CU28 y sus excepciones, no
entrega por correo/SMS, autonomía indefinida del empleado delegado, producción/cloud ni
calidad general de CU25/CU26. Revisión independiente del delta frente a `24f76a9`: conforme
en especificación, corrección y consistencia; cero críticos y sin repetir pruebas aprobadas.
Se actualiza exclusivamente CU28: **54/22/26 → 57/19/26** (3 puntos internos, no nota docente).

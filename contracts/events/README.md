# contracts/events
Eventos/comandos versionados, correlationId, operationId y deduplicación.
CU15 implementa el [contrato v1](cu15.v1.md), enlazado con la [Saga REST](../rest/saga.md): Outbox local por propietario, publicación RabbitMQ con confirms/mandatory e Inbox transaccional en Operaciones y Empleados. La matriz real distributed-real6 verificó retransmisión del mismo eventId, una fila Inbox y una notificación, sin repetir la asignación; evidencia en docs/context/STATUS.md y la especificación CU15 desde la raíz. Entrega al menos una vez, no exactamente una. Publicar un contrato no sustituye esa verificación ni acredita CU05 o lectura humana del aviso.


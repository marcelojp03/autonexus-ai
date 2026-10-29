# Estado comprobado

## Infraestructura local reproducible — verificada y revisada, cierre Git en curso (2026-10-29)

Se continúa T25 conservando CU05 abierto solo por G2 visual: la consulta de secuencia fue descartada sin respuesta y compose-next permite seguir la alternativa recomendada no destructiva. Ninguna publicación ni entrega completa se acredita.

Creado: Compose raíz de servicios reales, volúmenes/red por proyecto y solo web en loopback; recetas multietapa con imágenes fijadas por digest; bootstrap canónico sin rotación y configuración por consumidor; issuer público exacto/JWKS/token internos separados, binds/orígenes configurables y TLS PostgreSQL verificado opcional; configuración pública runtime del Shell sin secretos; readiness SQL de Finanzas y propuesta cloud sin despliegue.

Verificación previa al primer arranque: Compose config --quiet PASS; tres pruebas estructurales de Compose PASS; bootstrap en Node22.22.3 11 PASS y1 comprobación POSIX omitida por Windows; sesión/rutas35 PASS y tipos Shell/Empleados PASS tras respetar noPropertyAccessFromIndexSignature. Subagente reporta E55/BFF22 focalizadas, tipos/build PASS, F25unitarias95aserciones y3readiness9aserciones PASS; no se convierten en integración real. Java21 verificado por principal: AccessTokenDecoderTest21 +TransportConfigurationTest4,25 PASS, output/stack/t25-ops-transport-01.exit=0.

Aceptación posterior sobre fuente `21bbcd8e67765782bef033b098a5bbaac560acde`: copia pública sin `.git`, dependencias, builds ni secretos host; proyecto `autonexus-clean-verified`, puerto 4282, volúmenes nuevos. Una única orden `docker compose --env-file .env.example --profile demo up --build -d` dejó web saludable y demo terminada con código 0 en 320,363 s, con caché normal habilitada (no build en frío). Evidencia ignorada: `output/stack/t25-fresh-verified-01.json`, log y `.exit=0`. RabbitMQ sin reinicios en esta corrida. El proyecto parcial `autonexus-local` también reanudó sin reset ni regeneración (`t25-resumed-default-01.json`, `.exit=0`).

Verificador Chromium real sobre el proyecto nuevo: `t25-browser-fresh-01.exit=0`; diagnóstico saneado con consola/página/red/HTTP/transporte todos en 0. Agendas y detalle A/B/jefe, filtros/fechas La Paz bajo Pacific/Auckland, ataques REST/GraphQL, recargas y navegación Angular→React→Angular. Capturas enmascaradas generadas en escritorio/móvil; **G2 visual CU05 sigue bloqueado** porque los canales disponibles solo devuelven texto/enlaces, sin píxeles inspeccionables. Ni la corrida funcional ni el mensaje «Image viewed successfully» acreditan revisión visual.

Repetición conservadora (`t25-repeat-verify-01.exit=0`): credenciales, comandos, IDs y edición posterior de cliente preservados. Reinicio de diez contenedores propios (`t25-full-restart-01.exit=0` y `t25-full-restart-result.json`): cinco credenciales/subjects y fingerprint canónico conservados. Caídas E/F deliberadas, etiquetadas INYECTADO, probaron error explícito sin falso vacío y recuperación de la misma Saga tras reiniciar O (`t25-recovery-01.exit=0`). Lecturas SQL readonly por propietario comprobaron referencias O/E/F, efectos únicos y entrega Outbox/Inbox/notificación; no son una transacción distribuida ni lectura humana.

Regresión focalizada `t25-regression-01.exit=0`, incluidos 34 HTTP BFF y 5 HTTP financieros/46 aserciones. Nueva ejecución Node22 de los seis `infra/local/*.test.mjs`: 45 PASS, 0 FAIL, 2 omitidas en Windows; la ejecución Linux previa de bootstrap/transporte/política verificó permisos POSIX. `docker compose ... config --quiet` PASS. Historial fallido conservado: plataforma PHP/extensiones, COPY Angular, permisos F, temporales Nginx, timeout inicial IdP y cookie RabbitMQ; no se reinterpretan como éxitos.

Medición aproximada en Linux x86-64 (12 CPU, 15,4 GiB para Docker): muestra de diez contenedores tras calentamiento, 1457 MiB RAM y 24,76 % CPU acumulada. Corrección C2: 26 muestras durante 89,366 s y reinicio controlado de O del proyecto aislado registraron máximos observados de 1836 MiB y 522,95 % CPU agregada, con salud final de nueve aplicaciones y publisher financiero activo (`t25-peak-01.json`, `.exit=0`). Se excluyen daemon/build/host/entornos ajenos. No son promedios, requisitos mínimos ni máximos absolutos: el muestreo omite posibles transitorios y no mide el pico de compilación. Tamaños lógicos y alcance en `t25-resources-01.json` y guía local; no se purgó caché para producir cifras.

Revisión independiente general-50: inicialmente no aprobatoria por C1 (exclusiones privadas incompletas del contexto Docker) y C2 (pico no medido), más N1 (bloque vacío en Finance). C1 tiene regresión BuildKit real con archivos sintéticos: rojo antes del fix, verde después, sin secretos reales ni exposición observada; preserva fuentes, contratos y lockfiles. Exclusiones y N1 corregidos, C2 medido como arriba. Re-revisión independiente general-51 aprobatoria sobre las correcciones, sin nuevos bloqueantes de cumplimiento/corrección/consistencia; no sustituye ni oculta el dictamen inicial. Correcciones en `71108ad`; suite posterior de siete archivos: 46 PASS, 2 SKIP Windows, 0 FAIL y `git diff --check` PASS.

README público y guías contienen comandos observados, datos académicos confirmados, cuentas exportadas solo en privado y propuesta cloud sin desplegar. T25 está verificado y revisado; falta registrar el cierre Git autorizado con FF y push normal exacto de ambas ramas y comprobar sus SHA remotos. Los recursos antiguos permanecen intactos; CU05 conserva su bloqueo visual separado y no se declara entregado aunque su código se integre con la infraestructura.

## Revisión CU05 — F1/G1 resueltos; G2 visual bloqueado (2026-10-29)

La revisión inicial de 478b9bf no fue aprobatoria: F1 descartaba roles personalizados en sesión/guard web; el control real focalizado descubrió además el mismo filtro en el verificador JWT del BFF. Se conservan slugs válidos únicos como metadatos de presentación, sin modificar firma/issuer/audiencia/vigencia, permisos por campo ni vínculo vigente en propietarios. SessionIdentity.roles admite string[]; el DTO técnico CU01 conserva su tipo anterior.

Verificación de esta corrección: 32 pruebas de sesión/rutas PASS; tipos Shell/Empleados/Operaciones PASS; build integrado Empleados y Shell PASS (review-custom-web-build-01.exit=0); BFF 128 unidades y 34 HTTP PASS, tipos/build PASS, lint sin errores ni advertencias. Pruebas nuevas reprodujeron el fallo antes del fix.

Evidencia real focalizada: review-custom-real-04.exit=0 y a03d36aa-f29c-4ece-8b54-15c5a2fed7bf/result.json, cuatro etapas PASS. Empleado activo vinculado con rol exclusivamente personalizado: APIs/BFF y login/montaje/recarga web. Retiro solo de agenda:read:team manteniendo self, employees:read, schedules:read y orders:read; tokens anterior/nuevo denegados en contexto/selector/check/lista/detalle de equipo y tres campos GraphQL, sin datos; agenda propia sigue accesible. No se crearon trabajos ni se repitió la matriz Saga. Control sintético inactivado con historial conservado. Intentos01–03 siguen FAIL: 01 filtro real BFF; 02/03 asunciones del harness sobre foco de fecha/ShadowRoot. 04 registra cuatro Tabs para pasar del control date Desde a Hasta.

Re-revisión independiente general-44: F1 cerrado, G1 cerrado, delta conforme/correcto y sin bloqueantes de código. Aclaración no bloqueante del README Empleados aplicada. **G2 no aprobado**: principal y revisor recibieron solo texto de éxito al abrir PNG, sin píxeles inspeccionables. Teclado funcional no acredita foco visible, contraste ni recortes móviles. No se declara CU05 delivered ni se integra/publica todavía este cierre; T25 conserva diseño aprobado y queda pendiente de resolver la secuencia con esta limitación explícita.

## CU05 web online — verificado; revisión y cierre en curso (2026-10-29)

Diseño/políticas aprobados, primero CU05 y después infraestructura T25. Implementado en work/marcelo desde df91374: agenda propia/equipo/detalle, APIs propietarias, BFF/SDL y mf-employees/Shell, sin rama/worktree nuevos. Dos permisos cerrados (catálogo25), vínculo laboral activo/current subject obligatorio por petición, sin fallback de infraestructura para CU05 ni CRUD general como atajo. Contratos agenda REST/GraphQL y decisión017.

| Verificación observada | Resultado |
| --- | --- |
| Empleados | 173 unidades y86/86HTTPsintéticas PASS; tipos/build/lint0 (14 advertencias previas). Se completaron fakes del autorizador en harness antiguos sin modificar la política productiva; la comparación baseline fue lectura de código |
| Operaciones | 34 CU05 +22 regresiones existentes verificadas focalmente, compilación/package0; sin cambios productivos de Saga |
| BFF | 125 unidades,34HTTPsintéticas,tipo/lint/build PASS tras corregir autorización preexecute |
| UI/Shell | 27focales agenda/habilitación (incluye reloj h23),2política sesión,28Shell,tipo/lint/build0; detectorUI[] |
| Migraciones/runtime | E1793541600000aditiva aplicada yO V8índices; rollout0 E/O/BFF,Shelldistservido; brokerpropio recuperado exit137/OOMfalse sinrotarcredenciales/volumen |
| API real | real-api-01.exit0,run b4a86176-612c-4372-9f93-ada0ecf95372:3subjects vinculadosdistintos,CU15real,own/team/details/filtros/LaPaz/IDOR/sinatajosCRUD PASS4stages |
| BFF real | t246-bff-03.exit0,073ebc80-d380-4ef9-b672-af9ae4cf7ded:2stages campos,aliases/PII/IDOR/atajosdenegadossinData |
| Browser final | t246-ui-final-h23-01.exit0,36918efc-d4cb-47c7-9458-d77a03032f12: A/B+jefe,detalle/recarga/logout/cambioA→B,empleado/prioridad/vacío/offline/recuperación;10capturas1440/390,0errores,noJWTpersistido |
| Zona horaria | DOM/IntlNode/IntlbrowserAucklandcoincidenenLaPaz2026-11-05 23:00–23:30,UTCinicio2026-11-06T03:00:00Z |
| Estados/consistencia | t246-consistency-01.exit0,9344e9fd-c41e-4642-a6b1-d3f84a79dec7:4stagesreserved/confirmedlocal/releasedexcluidos,releasepropioidempotente |
| Subject/vínculo | 7e22da7f-3acb-4c55-805f-e0404eb0e02e:2stageslinkedpairPASS+CASrestoreexacto;runcompletoFAILporhookbrowseranteslocks,NOreinterpretarPASSglobal |
| Globalpending/Inbox | t246-globalpending-02.exit0,e47a8bb1-eca2-44b5-81da-442408b3f3c6:4stagesOconfirmation_pendingexcluido,globalreal+avisopending→publicación/Inboxobservedreal;triggerpropioquitado |
| Dependencia | t246-dependency-01.exit0,0b561f21-0c0f-4289-9a23-fa05408f113f:REST/BFF/browser503noFalseEmpty,sameworkrecuperado,DIRECTantesydespuéscerrarproxy |
| Identidad final | identity-green-main-01.exit0,07ed63da-69fe-417e-a877-16d57bb72d38:3stages2controlesnuevosINACTIVE/REVOKED,0jobsnuevos;old/freshJWTsdenegadossinData,inactivoyrevocadoconFORBIDDEN403 |
| Regresión API/BFF | CU02 14etapas,CU03BFF6,CU04 11,flujoCU11–14 6:exits0enregression-main-01.log. Wrapperexit1porpostcheckEEXIST (archivo protegido);sólopostcheckrerunconnombreúnico |
| Postcheck final | postcheck-main-02.exit0,postcheck-main-02.json:8/8,ownershipCIM/JAR/listener,DIRECT ylecturaposterioraproxy,0trigger/barrierpropio,eventoobservado,participantereleased,DRIFTrestaurado |

Todos los artefactos citados están bajo output/cu05 ignorado, incluidas cuentas sintéticas privadas nuevas; no versionar private.json, credenciales ni JWT. Los datos/identidades/credenciales existentes se conservaron. Las inyecciones de transporte, bloqueo/retraso Outbox y vínculo TEST se identificaron como tales y se restauraron; no se insertaron estados de negocio confirmados entre bases. No se repitió la matriz completa de Saga al no cambiar su lógica.

Defectos y fallos preservados: selectores del harness colisionaban con Shell y recargas provocabanabortos;seacotaronysinignorarfallosgenerales. Formato mixto12/24h/NBSP no era desplazamiento de instante; seunificó24hconregresiónrojo→verde ybuild. La inactividad expuso un bugproductivo: errorE403antesdeexecuteGraphQLera503genérico. Reprorealt246-identity-red-02/28645ba7-b147-4936-abed-ec466a9d73bdcapturó503sinData;9nuevasregresionesHTTP(6fail3pass→34totalPASS),controllerpreservaBusinessErrorpúblico,reinicioBFF35212yrealgreen403sinData. No se reactivaron controles ni se persistieron JWT para repetir pruebas.

Pendiente: revisión independiente y resolución de hallazgos, informe/traspaso y publicación normal exacta main/work/marcelo. CU05 todavía no marcado entregado. T25 aprobado y secuenciado después de esta verificación/revisión; Docker/bootstrap/demo/README público aún no implementados. Sin offline, Flutter ni lectura humana de notificaciones.


## CU15 — entregado, integrado y publicado (2026-10-28)

Revisión independiente inicial de 69de9bd: no aprobatoria (C1–C4/G1). Correcciones en bdf75fa5c5beb5be5116a52a0179f719d9b6bfc7: re-revisión independiente aprobatoria, objeciones retiradas y sin críticos residuales. Verificación posterior completa y código publicado por FF/push normal de main y work/marcelo; ls-remote confirmó ambas en 0350a46dab2a7dbedb209e42f704e00f2343cae0. El cierre posterior es exclusivamente documental. Se conserva la evidencia fallida histórica.

T23 en work/marcelo desde 0fc8f7f. Diseño aprobado mediante compose-next, sin otra rama ni worktree. Operaciones orquesta; Empleados reserva/confirma/libera; Finanzas registra y cancela un vínculo durable/versionado de la cotización aprobada. Aprobar una cotización por sí solo no confirma el servicio. CU05, offline y Flutter no se acreditan.

Políticas aprobadas: habilitación laboral explícita mechanicEnabled (backfill false, sin identidad/roles automáticos), especialidad declarada, intervalo del mismo día de La Paz, vigencia financiera inclusiva validada al autorizar y reserva sin TTL de negocio. Estados, permisos, identidad técnica y compensaciones: contracts/rest/saga.md y docs/compose/spec/cu15-confirmation-saga.md.

Implementación creada: dominio/puertos/adaptadores propietarios, ledger y Outbox locales; Saga durable con lease/fencing, cuerpos/IDs congelados y recuperación; RabbitMQ con confirms/mandatory y consumidores Inbox; GraphQL/BFF sin coordinación; pantallas existentes extendidas para habilitación, selección y progreso por URL. Catálogo ejecutable de 23 permisos, conservando personalizaciones al migrar.

| Evidencia observada | Resultado |
| --- | --- |
| Empleados, unidades / HTTP sintético / tipos / build | PASS 144 + 11; los dobles no acreditan integración |
| Finanzas, PHPUnit / lint PHP | PASS 24 pruebas y 113 aserciones / 29 archivos |
| Operaciones, suite / regresiones / package | PASS 120 pruebas tras corregir C1/C4 y proyección; rojo22/6fallos→verde28focalizadas; package y runtime corregidos |
| BFF, unidades / HTTP sintético / tipos / build | PASS 54 + 15 |
| Web focalizada / tipos / builds integrados y Shell | PASS 45 de confirmación (27 nuevas + 18 previas), 28 Shell (incluye 19 de sesión); tipos, ESLint focalizado y builds de Operaciones/Shell PASS |
| Infraestructura real | RabbitMQ 4.2.9-management fijado por digest, topología/identidades por productor; coordinador Keycloak con 7 scopes y solo audiencias E/F, sin realm-management |
| Migraciones reales | Empleados 1793455200000, Finanzas 2026_10_28_000002 y Operaciones Flyway V7 aplicadas |
| Finanzas real, scripts/cu15/verify-finance-real.mjs | PASS 6 etapas: identidad, ledger/replay/conflicto, vínculo/cancelación conservadora, carrera SQL y publicación confirmada medida |
| Navegador real, scripts/cu15/verify-confirmation-web.mjs | PASS 6 etapas: inelegibilidad y habilitación explícita en ficha; inicio autorizado; confirmed tras recarga sin efectos nuevos; referencias en tres bases y Outbox/Inbox; desktop/móvil sin errores |
| Matriz distribuida, scripts/cu15/distributed-real.mjs --run --browser-proof --max-minutes=20 | PASS 7/7, exit 0: carreras por orden/franja, rechazo F con release E, respuesta perdida tras commit, reinicio recuperable sin JWT browser, compensación inicialmente fallida y Outbox duplicado con efecto único |
| Regresión real CU01 / CU02 / CU03 BFF / CU04 / CU11–14 BFF | PASS 10 comprobaciones / 14 / 6 / 11 / 6 etapas, todos exit 0; logs regression-* en output/cu15 |
| OpenAPI con SnakeYAML 2.6 / JDK 21 | PASS Finanzas 9 operaciones/74 refs, Operaciones 31/147 y Empleados 7/53; sin claves/IDs/parámetros duplicados, contratos previos preservados |

Evidencia local ignorada: output/cu15/browser-real3.log y .exit=0, browser-real.json, finance-real2.log y .exit=0, ops-lock-red/green, y distributed-*.json. El verificador financiero --once procesa una fila: exit 0 por sí solo no acredita publicación; se verificó published_at con RabbitMQ real. El fallo JDBC inicial (ResultSetExtractor nulo) fue corregido y cuenta con regresión.

Incidentes de verificación, no fallos de negocio acreditados: aserción de navegador que buscaba error global en vez del paso incierto; cancelaciones de assets Angular durante OIDC (harness autentica primero en Shell); comprobación de puerto libre basada incorrectamente en timeout HTTP (corregida a TCP ECONNREFUSED). RabbitMQ terminó espontáneamente con exit 137, OOMKilled=false, y se recuperó conservando volumen/privados; no se presenta como inyección. Otra corrida terminó con código Windows 3221225786 sin finally: no es PASS y requiere restauración directa controlada. Los fallos de transporte/SQL deliberados del harness sí se etiquetan INYECTADO.

Matriz final: output/cu15/distributed-real6.exit=0 y distributed-2026-10-29T00-21-30-311Z-0749409d.json (PASS; 20:21–20:24 del 28 de octubre en La Paz). Ambos navegadores recovery_pending/compensation_pending con issues=[] y failed=[], retry de la misma Saga y reserva provisional. Retransmisión observada del mismo evento: intentos 1→2, payload idéntico, una fila Inbox/una notificación. final-check6.json verifica runtime DIRECT E3002/F8000, readiness 200 UP y flag sintético restaurado; no hubo caídas inesperadas en la corrida final. Supervisor y runner ambos detached/windowsHide; esto no demuestra la causa de la terminación Windows previa.

La regresión conservó la evidencia fallida inicial: CU02 esperaba 14 permisos en vez del catálogo vigente de 23; CU03 esperaba HTTP403 aunque la autorización por campo usa GraphQL200 con FORBIDDEN/statusCode403. Se corrigieron solo los verificadores, comprobando ausencia de datos y denegación tipada; no se cambiaron permisos productivos. Reanudación CU03→CU04→CU11–14 exit0 sin repetir CU01/CU02 ya verdes.

Correcciones de revisión verificadas (artefactos ignorados en output/cu15):

- review-ops-all.exit=0: 120 pruebas; review-ops-package.exit=0 y despliegue con flags CU15. Unicode real (review-unicode-real.exit=0 y unicode-real-1793237617193.json) confirmó una Saga con NBSP/FEFF/espacio ideográfico normalizados antes de congelar, huellas O/E idénticas y una reserva.
- c2-c3-post-lint-unit.exit=0: 45 pruebas; sesión 19 y Shell 28 PASS; tipos/ESLint sin errores. review-web-builds2.exit=0: build integrado de Operaciones, pruebas/tipos/build/staging Shell. Detector funcional UI sin hallazgos; sin rediseño.
- review-recovery-web-02.exit=0 y recovery-web-real-2026-10-29T01-39-51-287Z-b671961b.json: 6/6, dos abortos pre-upstream INYECTADOS; 404 real persistente tras reload, replay manual idéntico, una Saga/efectos en tres bases, limpieza terminal y logout con wizard desmontado; cero errores/fallos inesperados, sin JWT/storage alterado por harness. El intento01 falló por una espera ajena al ShadowRoot y se conserva.
- g1-boundaries-real-02.exit=0 y boundaries-b0924291-9da3-4031-9b15-2b09c2b89493/{result,postcheck}.json: 10/10 cruces reales (dos financieros y ocho de Empleados), esperas SQL observadas, nueve limpiezas idempotentes y estado final íntegro. Son fronteras E/F, no confirmación global. El intento01 no acreditó los dos waiters en plazo y permanece FAIL.
- review-distributed-real-07.exit=0 y distributed-2026-10-29T01-43-46-062Z-295b0153.json: matriz 7/7 y ambos navegadores PASS tras los fixes. review-distributed-final07.json verifica DIRECT, readiness200, flag sintético restaurado y un Inbox/una notificación tras retransmisión idéntica. No hubo caídas inesperadas.

Cierre administrativo observado: FF en main y push normal exacto de main/work/marcelo, sin force ni otras ramas/tags/PR. Código revisado y evidencia publicados en 0350a46dab2a7dbedb209e42f704e00f2343cae0 para ambas refs. Ramas/worktrees, privados y volúmenes conservados. El commit posterior solo asienta este cierre y se publica con la misma verificación remota. Siguiente entrega: CU05 con órdenes/asignaciones reales; todavía no se acredita offline ni Flutter.


## T21 — React y pantallas de recepción, órdenes y cotizaciones (2026-10-28)

Implementación verificada y revisada directamente en work/marcelo desde la base publicada f63ed9803dc3ec147d51b94ea847fc515628fe62. Cierre Git autorizado mediante fast-forward a main y push normal de ambas ramas, conservándolas; los SHA remotos se comprueban al finalizar. No se crearon ramas/worktrees ni se reinicializaron proyectos.

| Capa | Estado observado |
| --- | --- |
| Backend CU11/CU12 y CU13/CU14 | Se conserva la entrega previa de Operaciones y Finanzas con bases propietarias; sin cambios en dominio, migraciones ni persistencia en T21 |
| BFF | Reutiliza los contratos existentes; corrige propagación de errores CU11/CU12 y filtro open, y permite el origen independiente 4204; permisos por campo intactos |
| Shell y React | Finance registrado en modules, rutas/hosts/props propios, ESM con exports reales, CSS/portales aislados y sesión compartida; arranque independiente empresarial en 4204 |
| Pantallas Operaciones | Recepción textual con cita opcional, kilometraje y condiciones; consulta/creación de órdenes con prioridad, servicios, tarifas/duraciones copiadas, número, versión y estado |
| Pantallas Finanzas | Órdenes, creación/revisión y desglose servidor, versiones superseded, selección explícita para aprobar/rechazar y evidencia obligatoria; UUID para referencias de cliente/vehículo |

| Verificación T21 | Resultado |
| --- | --- |
| React, Vitest focalizado integrado/lifecycles/standalone | PASS 25/25, Node 22.22.3, un worker, testTimeout=15000 |
| React, ESLint de los nueve archivos JS/JSX modificados | PASS, cero errores/advertencias; sin desactivar reglas |
| Angular, intake.spec.ts en Chromium | PASS 9/9; tipos y builds integrados de ambos Angular PASS |
| Shell, pruebas de sesión/rutas/sincronización | PASS 25/25; tsc, staging de tres módulos y build PASS |
| BFF, unitarias / HTTP / tipos / build | PASS 32 + 13; tsc --noEmit y nest build exit 0 |
| Recorrido empresarial scripts/finance/verify-t21-web.mjs | PASS 8 etapas/exit 0: dos recepciones/órdenes en Angular, dos cotizaciones en React, v2 y v1 superseded, rechazo/aprobación seleccionados, evidencia, recarga, referencias UUID y error real al revisar una aprobada desde vista obsoleta |
| Montaje/rutas scripts/finance/verify-react-integration.mjs | PASS 12 etapas/exit 0: exports del ESM servido, MOUNTED y mount con host/basePath reales, unmount/remount, cuatro rutas previas de Operaciones, historial propio y cruzado, Empleados/horarios/seguridad, recarga y escritorio/móvil sin fuga CSS |
| Independiente scripts/finance/verify-standalone-web.mjs | PASS 4 etapas/exit 0: cliente PKCE propio, GraphQL real, recarga SSO, paso al Shell sin segundo ingreso, logout y desmontaje |
| Regresión BFF scripts/operations/verify-flow-bff-real.mjs | PASS 6 etapas/exit 0: recepción → orden → cotización → decisión y denegación por permiso |
| Instalación Finance frozen y detector de interfaz | PASS frozen con lock intacto; detector [] en las superficies nuevas |

Los tres verificadores de navegador usan Keycloak, APIs y PostgreSQL reales, sin mocks ni inyección de marcadores. La aprobación no cambió el estado de la orden: siguió pending_quote, sin mecánico. Recepción no puede crear cotizaciones; el mecánico queda denegado en Finance. Consola/pageerror limpios; se conserva en diagnóstico una cancelación ERR_ABORTED de recurso Angular al navegar, sin HTTP fallidos. Capturas desktop/mobile y diagnósticos locales en output/playwright/, logs/exit en output/t21/ (ignorados).

Hallazgos corregidos: ESM servido sin exports por tree shaking; Finance fuera de modules y basePath incorrecto; retorno OIDC excluía /finance; decisiones ligadas a la primera pending, referencias por nombre/placa y evidencia ficticia de fallback; códigos nuevos y open omitidos por BFF; cliente independiente sin claims sub/usuario por scopes basic/profile ausentes; Router Angular desincronizado de enlaces del Shell (observado en ejecución y reconciliado con API pública y cleanup); hooks React con resets sincrónicos/ref cleanup. La corrida conjunta inicial React dio 24/25 por agotar 5 s de una interacción; la ejecución aislada con 15 s dio 25/25 sin cambiar aserciones. Se mantienen avisos de pseudoelementos de jsdom y tamaño del bundle (~1,025 MB integrado antes de gzip), no se ocultan ni se elevan presupuestos del build.

Revisión de cierre **directa**, del rango f63ed98..5080cdc53a8c787dd034859f939b3b37cb3f4b5d: sin bloqueantes de cumplimiento/corrección. El revisor independiente general-20 falló al iniciar por SQLiteError: database is locked y fue cancelado sin dictamen; no se acredita independencia. Cierre posterior solo documental. Control de publicación del código: 1 commit, 51 blobs, sin archivos privados/generados, claves privadas ni material JWT detectados por el escaneo del rango; se renueva contra el HEAD documental antes del push.

Límites: CU11 aquí cubre registro textual, no fotografías/S3 ni inspección IA; offline, cobros, indicadores, CU05 con asignaciones y Saga CU15 siguen pendientes. Aprobar no confirma el servicio. La persistencia existente se conserva: Spring usa JDBC/Flyway, Nest TypeORM con SQL explícito y entities:[], Laravel Query Builder, y BFF sin base. Decisión 015; especificación operations-flow.

## Base backend — recepción, órdenes y Finanzas con Laravel (2026-10-28)

**Resumen vigente.** Operaciones suma CU11 recepción e inspección y CU12 orden de trabajo; Finanzas nace como servicio Laravel con PostgreSQL propio para CU13 cotizaciones versionadas y CU14 decisión del cliente. El catálogo pasó a **21 permisos** con actores por CU; Finanzas valida el token con OpenSSL y JWKS, audiencia `autonexus-finance-api` y permisos resueltos contra Empleados con caché de 30 s. Una orden nace `pending_quote` y **no asigna mecánico**; aprobar una cotización **no confirma el servicio**: eso es CU15, cuyo contrato queda en `contracts/rest/saga.md`.

| Verificación | Resultado |
| --- | --- |
| Operaciones `mvnw test` / package | PASS 82 pruebas y jar exit0 |
| API real recepción/orden (`scripts/operations/verify-receptions-orders-real.mjs`) | PASS 7 etapas/exit0: permisos, recepción abierta única, kilometraje, orden con número y copia de tarifa, servicio inactivo, orden duplicada, auditoría |
| Finanzas: migraciones y PHPUnit | PASS tablas creadas y 6 pruebas del calculador |
| API real cotizaciones (`scripts/finance/verify-quotes-real.mjs`) | PASS 8 etapas/exit0: cálculo en servidor, descuento máximo, total inconsistente, versionado con `superseded`, aprobación inmutable, expiración, rechazo con evidencia, idempotencia |
| BFF `pnpm test` / `test:e2e` / build | PASS 22 unitarias + 13 HTTP y build exit0 |
| BFF real (`scripts/operations/verify-flow-bff-real.mjs`) | PASS 6 etapas/exit0: recepción → orden → cotización → decisión por GraphQL con denegaciones por permiso |

**Histórico React (T21) en f63ed98:** se publicó únicamente la base técnica compilada, con Finance aún fuera de modules y pantallas de recepción/orden pendientes. Ese estado es la base de la continuación T21 documentada arriba; no describe la entrega actual. IA, fotografías/S3, cobros e indicadores siguen pendientes, y CU15 no se implementó.

**Persistencia documentada:** Operaciones usa `JdbcClient` con SQL parametrizado y Flyway; Empleados usa TypeORM para conexión, transacciones y migraciones con SQL explícito y `entities: []`; Finanzas usa el Query Builder de Laravel con SQL explícito; el BFF no tiene ORM. No existen entidades ORM mapeadas.

## Bloque operativo — CU06, CU07, CU09 y CU10 entregados y verificados (2026-10-28)

**Resumen vigente.** Rama `work/marcelo`. Operaciones (MS01) deja de ser un esqueleto: clientes, vehículos con historial de propietario, catálogo de servicios y citas, con persistencia PostgreSQL propia (Flyway V2–V4), autorización por permiso en REST y BFF, y pantallas en `mf-operations`. El catálogo de CU02 pasó de seis a **catorce permisos**; los roles iniciales se resembraron respetando los actores de cada CU (`administrador` todos, `jefe_taller` suma catálogo y agenda, `recepcionista` clientes/vehículos/citas, `mecanico` y `responsable_financiero` sin permisos). CU03 sigue administrador-only y CU04 no cambia.

Operaciones resuelve los permisos del portador llamando a `GET /security/permissions` de Empleados con el token del usuario (caché 30 s, timeout 2 s, fallo cerrado); no consulta bases ajenas ni duplica la matriz. `/technical/*` conserva la política y el cuerpo de CU01.

Reglas de cita: cliente/vehículo/servicio activos, vehículo del cliente declarado, `startsAt` ISO-8601 con offset, duración del servicio para `endsAt`, duplicado exacto, solapamiento del vehículo y capacidad del taller (por defecto 2) evaluados bajo `pg_advisory_xact_lock`; reprogramar revalida y cancelar exige motivo y libera la franja. **Una cita no es una orden de trabajo ni asigna mecánico**; no existe estado `confirmed`.

| Verificación | Resultado |
| --- | --- |
| `services/operations` `mvnw test` / package | PASS 30 pruebas (validaciones, casos de uso, permisos con caché y fallo cerrado) y jar exit0 |
| API real CU06/CU07 (`scripts/operations/verify-customers-vehicles-real.mjs`) | PASS 9 etapas/exit0: permisos por operación, duplicados, versiones, replay, cambio de propietario trazado, cliente inactivo, auditoría |
| API real CU09/CU10 (`scripts/operations/verify-catalog-appointments-real.mjs`) | PASS 11 etapas/exit0: duplicado por nombre, duración/tarifa inválidas, desactivación, cita con duración, duplicado, solapamiento, propiedad, servicio inactivo, capacidad, reprogramación, cancelación que libera la franja |
| BFF real (`scripts/operations/verify-bff-real.mjs`) | PASS 9 etapas/exit0 por GraphQL hasta PostgreSQL |
| Navegador real (`scripts/operations/verify-operations-web.mjs`) | PASS 9 etapas/exit0: recepción registra cliente, asocia vehículo y agenda; jefatura crea servicio; reprogramación y cancelación; mecánico denegado por el servidor; consola limpia |
| BFF `pnpm test` / `test:e2e` / build | PASS 20 unitarias + 13 HTTP y build exit0 |
| Empleados `pnpm test` / build | PASS 90 pruebas (catálogo de catorce permisos) y build exit0 |
| Regresión CU01 API / CU02 API / CU02 web / CU03 / CU04 | PASS 10 comprobaciones y 14, 9, 11 y 8 etapas, todas exit0 |

Hallazgos corregidos durante la verificación: `mvnw package` fallaba si el jar estaba en uso por el servicio en ejecución (se detiene antes de empaquetar); el duplicado exacto de cita devolvía `APPOINTMENT_OVERLAP` porque el solapamiento se comprobaba antes que la duplicidad; la migración de catálogo incrementa la versión de los roles `system`, así que el verificador de CU02 debía leer la versión vigente en lugar de asumir 1; y la prueba de concurrencia de CU02 necesitaba un administrador de apoyo limpio porque el rol `limitado` seguía otorgando `security:write`.

Revisión **independiente** de `b1bac1a..7277fa4` (subagente revisor): cero críticos y dos hallazgos mayores, ambos corregidos. (1) El cambio de propietario de un vehículo con citas programadas dejaba citas apuntando al propietario anterior e imposibles de reprogramar: ahora el cambio y la desactivación con citas programadas responden `VEHICLE_HAS_SCHEDULED_APPOINTMENTS`, y desactivar un cliente con citas responde `CUSTOMER_HAS_SCHEDULED_APPOINTMENTS`. (2) La idempotencia usaba un `INSERT` plano: dos peticiones concurrentes con el mismo `operationId` acababan en `500`; ahora usa `ON CONFLICT` con verificación de huella (`IDEMPOTENCY_CONFLICT` si difiere, replay si coincide), la huella separa campos con `U+001F` para no colisionar y las citas releen el replay tras el lock. Menores corregidos: la ventana por defecto de la agenda usa la fecha del taller y no UTC, el aviso de truncado cuando el rango supera 100 citas, las rutas de las cuatro pantallas también en el arranque independiente del microfrontend, y la especificación alineada con lo entregado (auditoría única en `operations_history`, respuesta de vehículo sin `ownerChanged`). Se verificó además la contención real: dos reservas simultáneas del último cupo de una franja no pueden tener éxito ambas, y el cambio de propietario y la desactivación quedan bloqueados con citas programadas.

Límites: sin permisos por registro; la sincronización offline de clientes y citas no está implementada; CU05 no se declara completo porque su agenda requiere órdenes y asignaciones reales (CU11/CU12/CU15); su consulta futura deberá identificar al empleado por el subject autenticado y añadir su permiso de agenda.

## Histórico — CU02 — Roles y permisos entregados y verificados (2026-10-27)

Rama `work/marcelo`. Se sustituye la autorización por nombre de rol fijo por un **catálogo cerrado de seis permisos** (`employees:read|write`, `schedules:read|write`, `security:read|write`) resuelto en el servidor, con roles y asignaciones persistidos en el esquema propio de Empleados (migración `1793196000000`) y materializados en Keycloak como realm roles. `contracts/auth/permissions.md` y `docs/decisions/012-cu02-roles-permissions.md` fijan la semántica.

Los cinco roles iniciales se siembran como `system=true` reproduciendo la autoridad previa: `administrador` los seis permisos, `jefe_taller` horarios, los otros tres ninguno. CU03 sigue siendo administrador-only y CU04 no amplía su alcance. Los permisos efectivos son la unión de los roles del token que existen en el catálogo, filtrados por las asignaciones vigentes del subject cuando está vinculado a un empleado: retirar un rol deja de otorgar permisos en la siguiente petición aunque el JWT lo mencione, sin prometer revocación de tokens.

Backend: `GET /security/permissions`, roles (lista y detalle), alta y modificación de roles con `operationId`/`expectedVersion`, `retry-sync`, asignaciones por empleado, retiro con historial y auditoría append-only. Reglas: sin escalamiento (`PERMISSION_ESCALATION`), nunca sin administrador (`LAST_ADMINISTRATOR` con `pg_advisory_xact_lock`), empleado activo con identidad para asignar, idempotencia y versionado. La identidad técnica suma `view-realm` y `manage-realm` a `manage-users`; el adaptador solo usa endpoints de roles.

BFF: `contracts/graphql/security.graphql` con diez campos raíz y política por **permiso** (no por nombre de rol); los permisos del actor se resuelven contra `GET /security/permissions` con caché de 30 s y fallo cerrado (503 si no puede resolver). `mf-employees` incorpora la sección `/employees/security` con tabla de roles, matriz de permisos, asignación/retiro por empleado, reintento de sincronización y el aviso explícito de la ventana de vigencia. El Shell agrega el enlace "Seguridad".

| Verificación | Resultado |
| --- | --- |
| `services/employees` `pnpm test` / build | PASS 90 pruebas (dominio, casos de uso, verificación de token) y build exit0 |
| API real CU02 (`scripts/cu02/verify-security-real.mjs`) | PASS 14 etapas/exit0: permisos efectivos, rol materializado en el IdP, asignación con identidad, dos reglas de último administrador, escalamiento con token limitado, retiro concurrente que deja exactamente un administrador, unión de asignaciones, revocación efectiva sobre un token ya emitido, retry, auditoría, inactividad |
| BFF `pnpm test` / `test:e2e` / build | PASS 17 unitarias + 13 HTTP y build exit0 |
| BFF real por GraphQL (`scripts/cu02/verify-security-bff-real.mjs`) | PASS 7 etapas/exit0: catálogo, roles, denegación del jefe, alta, asignación, auditoría, retiro y CU03 aún administrador-only |
| Navegador real (`scripts/cu02/verify-security-web.mjs`) | PASS 9 etapas/exit0: crear rol, asignarlo desde la UI, retirarlo con confirmación, auditoría en el propietario, jefe denegado por el servidor y consola limpia |
| Regresión CU03 (navegador) | PASS 11 etapas/exit0 |
| Regresión CU04 (navegador) | PASS 8 etapas/exit0 |
| Regresión CU01 API (`scripts/verify-cu01-api.mjs`) | PASS 10 comprobaciones/exit0 |

Hallazgos corregidos durante la verificación: `UPDATE ... RETURNING` llegaba como `[rows, affected]` y rompía el mapeo; un `UPDATE` con un parámetro no referenciado producía error de bind; el contrato de `/technical/session` se rompió al añadirle `permissions` y el smoke CU01 lo detectó (se retiró; los permisos se publican solo en `/security/permissions`). Todos con corrección y nueva ejecución.

Revisión **independiente** del rango `a2e1451..b2fe58f` (subagente revisor, sin fallo de herramienta): cero críticos y seis hallazgos mayores, todos evaluados y corregidos en el commit de correcciones. Correcciones aplicadas: la política por campo del BFF es eludible con un fragmento inline en la raíz (ahora se rechaza, con prueba); la resolución de permisos usaba la foto del `subject` guardada al asignar en vez de la identidad actual del empleado y admitía roles nuevos para sujetos sin vínculo (ahora exige `e.subject` vigente y limita la rama sin vínculo a los roles iniciales); el invariante de último administrador no exigía identidad resoluble; una revocación fallida no se reconciliaba con el reintento; el escalamiento no se comprobaba al asignar; `retry-sync` no era idempotente; y `assignedCount` quedaba en 0 tras actualizar un rol. La contención de locks pasa de `503` a `409 CONCURRENT_OPERATION` y ahora está verificada con un retiro concurrente real. Se mantiene declarado como límite que la inmutabilidad de la auditoría es de aplicación, no de base.
Límites: sin permisos por registro; CU02 asigna roles pero no habilita credenciales de acceso; `Operaciones` conserva su política técnica por nombre de rol; la disponibilidad de CU04 sigue siendo informativa para CU15; la inmutabilidad de `security_history` es de aplicación.

## Histórico — CU03 web — BFF e interfaz entregados localmente (2026-10-27)

Rama `work/marcelo`, base main425ed03. Decisión009 habilita alcance no exclusivo: se implementaron BFF y pantallas sin esperar al participante2. Backend CU03 sigue siendo el de main; esta entrega agrega el recorrido web y no modifica reglas de negocio del servicio.

`integration/bff` es ahora una aplicación NestJS12.2.0 con GraphQL17.0.2 sobre el SDL de `contracts/graphql/employees.graphql`, sin ORM ni SQL. Puerto127.0.0.1:3004; expone siete campos raíz con allowlist, rechaza introspección/fragmentos/consultas fuera de límites y valida el access token del usuario (RS256, issuer, audiencia Empleados, exp, typ Bearer, rol administrador). Reenvía el mismo token a Empleados: no hay exchange, audiencia propia nueva ni credenciales administrativas de Keycloak en el BFF.

`SessionPort` incorpora `requestBusiness(query, variables)`; el propietario de la sesión renueva el token, llama al BFF y entrega solo datos o errores tipados. Los tokens permanecen en RAM; no hay getters ni copia a props/storage. La demo del template no monta estas rutas.

`mf-employees` incorpora listado con búsqueda/estado/paginación, alta, edición, historial y desactivación, con estados de carga, vacío, error, permiso insuficiente, conflicto de versión y sincronización de acceso pendiente. Conserva NG-ALAIN, single-spa y la sesión; el Shell agrega navegación solo en el módulo Empleados.

| Verificación | Resultado |
| --- | --- |
| BFF `pnpm test` / `test:e2e` / build | PASS 10 unitarias + 10 HTTP, build exit0; RSA sintético y upstream falso explícitos |
| BFF real contra Empleados+Keycloak | PASS 6 etapas/exit0: salud con upstream,401,403,lista con forwarding,introspección rechazada,error de negocio mapeado |
| `mf-employees` build:integrated | PASS exit0; advertencias CommonJS del template preexistentes |
| Shell build (tsc+vite+staging) | PASS exit0 |
| Recorrido web real (Playwright, Keycloak y PostgreSQL reales) | PASS 11 etapas/exit0: login,alta con acceso,estado de acceso,persistencia tras recarga,edición,fecha de ingreso tras recargar,conflicto+recarga,historial,desactivación confirmada,consola limpia,permiso insuficiente |
| Regresión de carrera del listado | Respuesta obsoleta podía sobrescribir la búsqueda; se descarta por secuencia y el recorrido vuelve a PASS |

Hallazgos corregidos durante la verificación: fecha NG-ZORRO requería entrada por teclado; `nz-alert` no proyecta el botón de recarga; el límite de profundidad GraphQL no contemplaba `snapshot.access`; y la carrera de respuestas del listado. Todos con corrección y nueva ejecución, no reclasificados como ruido.

Revisión independiente (`425ed03..988d55d`): nueve criterios de aceptación cumplidos; un crítico de corrección —la fecha de ingreso se construía en UTC y NG-ZORRO la interpretaba en hora local, mostrándola un día antes— y hallazgos no bloqueantes. Correcciones aplicadas: fecha por componentes locales con aserción de ida y vuelta; reintento de sincronización de acceso disponible en la ficha para un empleado cargado con acceso no sincronizado (camino compilado; el recorrido no provoca un fallo de IdP para ejercitarlo); confirmación al desactivar; catálogo cerrado de códigos del upstream; decodificación de `errors` vacíos; validación de especialidades; alta bloqueada tras registrar y edición sin empleado cargado; etiquetas y fechas legibles; accesibilidad de búsqueda y tablas; `.env.example` válido y textos de contrato alineados. Re-ejecutadas las verificaciones afectadas: BFF 10 unitarias + 10 HTTP PASS, build PASS, Shell 15 pruebas y build PASS, `mf-employees` build PASS y recorrido web 11/11 PASS (repetido con `TZ=Asia/Tokyo` para cubrir un huso positivo).

Evidencia local ignorada en `output-cu03web/` (logs de BFF, shell, Empleados, Operaciones y verificadores) y `output/playwright/cu03-web-list.png`. Los procesos lanzados con `Start-Process` morían al cerrar la herramienta; la verificación usó lanzamiento desacoplado. Estado remoto sin cambios: el primer push sigue preparado y NO ejecutado; los compañeros no tienen estos commits.

No se acredita CU02, CU04, agenda/asignaciones, Saga, móvil ni producción. CU03 se entrega como backend + web local, no como CU completo de punta a punta en remoto.


## Histórico — Integración CU03 en main — verificada y revisada; publicación pendiente

Cierre2026-10-26: integración efc2e1c..4bbf9af conforme por revisión fresca en cumplimiento/corrección/consistencia, cero críticos. Spec delivered; código empresarial no modificado. Auditoría código4bb:20commits/685blobs/871archivos/251entradasPASS sin hallazgos; reporte local debe renovarse contra HEAD documental final antes de publicar. No push/PR; backend raíz3002 entregado, BFF/interfaz pendientes. CU04 queda preparado enT3, no iniciado. Las menciones posteriores a revisión pendiente son fases históricas del recorrido.

Control de wrappers: Node --test scripts/cu03/wrapper-exit.test.mjs red2→green4/exit0, con hijos simulados en directorios temporales; propaga fallos7/9 y conserva éxito0, sin tocar aplicaciones/DB. La primera sesión de revisión no produjo dictamen (cancelada tras fallo de herramienta); se solicita una nueva revisión independiente. Esta corrección no modifica CU03 empresarial y no requiere repetir los smokes live aprobados.

Solicitud posterior2026-10-26: main89bc8e1 era ancestro de feat/cu03-employees efc2e1c, divergencia0/7. efc2e1c solo modifica especificación/STATUS sobre código revisado281b9ee. Commit documental897873b ajustó source a main y se integró por fast-forward; ramas/worktrees preservados, sin cambios ajenos descartados. HEAD final se obtiene con git rev-parse main; no push ni PR.

Backend definitivo en services/employees de raíz,127.0.0.1:3002, PID observado29100; sin listener3003. Nuevo start-main.ps1 valida root/main y dueños antes de detener, reutiliza entorno/cliente técnico privado y restaura entorno del llamador. -Restart sustituye solo Empleados reconocidos; sin flag conservó el PID. Arranque general CU01 delega Empleados al helper. Compose/volúmenes no se recrearon; no init/provision ni regeneración de secretos.

Verificación afectada: build/tipos raíz exit0, paquetes/lockfile sin cambios; migration:run exit0 con No migrations are pending. Smoke contra proceso VIVO3002 (no Nest efímero):6comprobacionesPASS/exit0 — salud SQL, siete rutas401/403 reales, alta/consulta sintética, modificación/historia/replay/version409, desactivación conservando3snapshots y seis archivos privados byte-idénticos. CU01 desde raíz:12etapas funcionalesPASS/exit0,0errores/recursos inesperados,2x403 deliberados; capturas previas reutilizadas, sin acreditar otra revisión visual. SQL aislamientoPASS1Ops/2Empl. No se repitieron70unitarias/42HTTP ni fallos distribuidos no afectados.

Evidencia ignorada: output/cu03-main-integration/{live-main,cu01-main,postgres-main,migration-main}.{log,exit}; build/types en output/cu03-employees. Traspaso participante2, comandos3002, GitHub y alcance/decisiones CU04: docs/handoffs/2026-10-26-cu03-main-cu04.md, enlazado desde docs/ai/HANDOFF.md. CU04 es tareaT3 abierta/preparada, sin código ni rama iniciados.

GitHub: origin saneado correcto, ls-remote exit0 sin refs; lectura no acredita permisos de push. Históricos sin paths privados/dependencias/artefactos locales; escaneo inicial897873b de18commits/667blobs/251entradas comprimidasPASS sin coincidencias de privados actuales ni patrones de alta confianza. Auditoría del HEAD final y revisión independiente de integración pendientes antes del cierre. Backend entregado; BFF/interfaz siguen pendientes: no CU03 de punta a punta ni CU02.

## Histórico — CU03 backend propietario — entregado localmente y revisado; BFF/interfaz pendientes

Cierre2026-10-26: revisión integral y re-revisiones afectadas conformes hasta código281b9ee. C1 y observaciones de consistencia cerrados, cero críticos pendientes. Especificación delivered con70unitarias/42HTTP,9grupos funcionales finales y15grupos previos de identidad/recuperación reales, todosPASS; CU01 root13etapas/SQLPASS. Los párrafos posteriores que dicen pendiente revisión describen etapas históricas del recorrido, no el dictamen final. No se acredita CU02 ni CU03 web completo; no hubo push ni merge CU03 a main.

Fecha2026-10-26. Rama feat/cu03-employees, worktree .worktrees/cu03-employees, base CU01 b8d8079 e incorporación de main89bc8e1. Contratos REST/GraphQL/autenticación publicados antes de implementar en12f44e6. Especificación aprobada docs/compose/spec/cu03-employees.md y decisión007. Sin push ni merge CU03 a main; no se tocaron AGENTS ni se reasignó el BFF del participante2.

Backend real de consulta/listado/historial, alta, modificación y desactivación sin borrado. Datos personales/laborales, cargo y especialidades; duplicados incluso inactivos, control de versión, auditoría e idempotencia ligada a actor/acción/destino/contenido. Siete endpoints autorizan administrador usando sesión CU01; cargo/especialidades no son roles. Persistencia exclusivamente PostgreSQL de Empleados: migración1793023200000 y cuatro tablas propias; Empleados ahora tiene2migraciones y Operaciones conserva1. No synchronize ni reinicialización de bases.

Cuenta Keycloak opcional con UUID empresarial/employeeId admin-only y subject estable. Cliente confidencial técnico autonexus-employees-admin con client_credentials, manage-users y scope explícitos; backend no usa bootstrap/personales. Su secreto nuevo se guarda por separado y se conservan los privados CU01. manage-users tiene alcance realm-wide; ownership por empleado se limita en adaptador, no es FGAP del IdP. Sin roles empresariales ni credencial habilitada la cuenta no tiene acceso operativo; synced no acredita CU02.

Transacción local empleado/historial/intención/resultado; IdP fuera de transacción, lock de sesión compartido por mutación/sync. Estado laboral separado de pending/synced/failed/conflict. Retry explícito recupera tras reinicio y éxito remoto con respuesta o confirmación SQL perdida, sin duplicar cuentas. Ownership incompatible no modifica cuenta ajena. No worker automático ni transacción atómica PostgreSQL+Keycloak.

| Verificación observada | Resultado |
| --- | --- |
| Empleados frozen/build | PASS, lockfile/versiones conservados; build final exit0 |
| Unitarias finales | PASS70/8archivos; incluye40CU01/base y30CU03; texto/Unicode rojo→verde y protección identidad propia |
| HTTP final, sin paralelismo entre archivos | PASS42/3archivos;32CU01/base+10CU03; RSA sintético/repositorio falso explícitos |
| Lint/tipos final | PASS exit0;0errores/0advertencias de lint |
| Matriz PostgreSQL+Keycloak real | PASS15grupos: persistencia, migración/no-op,401/403, duplicados/versión/historial, desactivación, cuenta opcional/sin reactivación por edición, respuesta perdida/reinicio/retry, ownership ajeno, fallo SQL posterior al remoto, lock entre conexiones, pérdida de sesión SQL con respuesta tardía/reparación y caída/restauración IdP real |
| Funcional final del límite ASCII | PASS9grupos/exit0, incluidos Unicode rechazado antes de case folding, mayúsculas ASCII, duplicado concurrente y cuenta deshabilitada; no repite recuperación no afectada |
| Contratos finales | OpenAPI3.1/referencias y sintaxis SDL PASS; no resolvers/BFF ejecutables |
| Regresión CU01 desde raíz tras cambios IdP | PASS13etapas/exit0,0errores inesperados/recursos fallidos y2x403 intencionales; SQL aislamientoPASS, versiones1/2 |

Evidencia local ignorada en output/cu03-employees del worktree: {build,test,test-e2e,lint,types}.{log,exit}, real.log/real.exit y functional-final.log. CU01: output/cu01-main-integration de raíz. Dos fallos iniciales de verificadores no acreditados: fixture documento41caracteres excedía40 y comparación entre representaciones IdP distintas; corregidos sin relajar reglas. Compilación inicial corrigió API real de QueryRunner sin genéricos; HTTP añadió probe falso explícito y ejecución secuencial, sin añadir secretos ni ocultar tests. Los PASS anteriores son ejecuciones posteriores observadas, no esos intentos.

Aplicaciones CU01 y ambos Compose permanecen en raíz. CU03 real se ejecutó desde el worktree con Nest en puerto efímero y se cerró al terminar; no hay proceso CU03 permanente acreditado. README explica PORT3003 manual para conservar CU01 en3002. Los registros de prueba son sintéticos, se conservan y desactivan; no se borran empleados/historia. Triggers temporales de fallo se retiran en finally; IdP propio restaurado.

BFF sigue siendo carpeta reservada, sin aplicación. Se entregan contratos al participante2; mf-employees conserva NG-ALAIN/demos y NO llama REST empresarial. No acreditar interfaz integrada, CU03 web completo, CU02, jornadas, agenda, Saga, otros servicios, Kubernetes ni producción. Revisión independiente inicial cerrada: C1 bloqueó emails inválidos; se reprodujeron8rojos,67unitarias/42HTTP posteriores pasan. Se corrigieron dos inconsistencias documentales y la reactivación de cuentas deshabilitadas reproducida con IdP real. La matriz final15grupos/exit0 incluye pérdida de la sesión SQL dueña del lock sintético y reparación explícita. El primer intento de restauración no se acredita: Keycloak arrancó en118s y excedió la espera anterior; el verificador ahora exige Dockerhealthy+discovery dentro de300s, sin recrear volumen. Cleanup acotado verificó origen sintético/desactivó los pendientes, sin borrado. Falta re-revisión antes de delivered. Fallos SQLite iniciales de agentes no sustituyeron revisión: la revisión independiente sí llegó a ejecutarse.

## Histórico — CU01 integrado: runtime definitivo verificado (2026-10-26)

La inspección inicial encontró main y feat/cu01-keycloak ya en b8d8079, divergencia0/0 y worktrees limpios. b8d8079 es hijo de86d81af y exclusivamente documental; código revisado1963ce3..86d81af. No se repitió un merge. Se preservan ramas/worktrees, sin push. Los apartados CU01 anteriores que sitúan main en1963ce3 son históricos.

Las seis aplicaciones se ejecutan ahora desde sus carpetas de raíz (rutas absolutas de artefactos verificadas). PostgreSQL empresarial conserva ownership infra/compose de raíz; IdP fue recreado con ownership/config/bind infra/keycloak de raíz sobre el MISMO volumen nombrado. Configuraciones privadas IdP/servicios comparadas byte a byte con worktree, sin regenerar secretos ni reinicializar bases. Ambos volúmenes existentes y tres contenedores healthy. Ver decisión006.

Builds afectados desde raíz PASS con exit0: Operaciones package -DskipTests, Empleados frozen/build, Angular OIDC/integrados y demo Empleados, Shell frozen/build/staging. No se repitieron suites completas CU01 por rutina. Regresión ownership Windows: red con separadores dobles, green1/1 y comparación completa de ubicaciones. manage.mjs verify PASS con IdP real. verify-main-runtime.mjs PASS en ownership/volúmenes/privados/readinessSQL/401.

Smoke real terminado desde raíz: browser13 etapas PASS/exit0, loginPKCE, navegación sin nuevo documento/login, reloadSSO, refreshreal, APIs200/403, standalone, logout, sin rol y demo;0 pageErrors/errores inesperados/recursos fallidos,2x403 intencionales. PostgreSQL17.11: aislamientoPASS,3rechazos por rol y1migración por servicio, exit0. Evidencia: output/cu01-main-integration/{browser-main.log,browser-main.exit,postgres-main.log,postgres-main.exit} y builds *.exit.

Límite honesto: el auxiliar de traslado se interrumpió después de recrear IdP y no retuvo el snapshot previo de IDs. No se acredita otra comparación automática antes/después de todos los IDs; sí volumen nombrado existente, bytes privados idénticos, configuración/cuentas y autenticación reales conservadas. Una sesión auxiliar falló por SQLite bloqueado del harness; el principal retomó y verificó sin repetir recreaciones.

Fecha: 2026-10-26. Los apartados anteriores de base/composición conservan fechas y resultados históricos.

## Histórico — Preparado

- Estructura de 13 aplicaciones previstas y carpetas compartidas.
- Reglas para IA, copias de Notion y 31 especificaciones de CU.
- Participante 1 identificado: Marcelo, bloque 1. Se conserva el reparto por CU; Operaciones incluye CU06–CU09 del bloque 2.
- Templates NG-ALAIN presentes directamente en web/mf-employees y web/mf-operations, con AGENTS locales preservados. La primera verificación partió de src idénticos; ahora existen entradas integradas propias, conservando el diseño standalone.

## Verificación inicial Angular MF01 / MF02 (histórico)

Verificación local del 2026-10-25. La raíz AutoNexus no tiene metadatos Git; cada template conserva un repositorio propio, rama master, commit base 58a5297f (release 22.1.1). AGENTS.md y README.md ya estaban modificados respecto al upstream antes de esta tarea. No se crearon commits ni se alteró la estructura Git.

| Comprobación                                  | MF01 Empleados             | MF02 Operaciones           |
| --------------------------------------------- | -------------------------- | -------------------------- |
| package.json / angular.json en raíz local     | Sí                         | Sí                         |
| Instalación pnpm 12.6.0 con --frozen-lockfile | Código 0                   | Código 0                   |
| Build producción (pnpm run build)             | Código 0, 144.379 s        | Código 0, 144.677 s        |
| Bundle desarrollo / serve                     | Generado, 109.276 s        | Generado, 109.303 s        |
| HTTP real independiente                       | 200 en 127.0.0.1:4201      | 200 en 127.0.0.1:4202      |
| Smoke navegador                               | Login demo → dashboard/v1  | Login demo → dashboard/v1  |
| Consola del recorrido probado                 | 0 errores / 0 advertencias | 0 errores / 0 advertencias |

- Versiones resueltas en ambos: Angular core 22.2.3, CLI/build/CDK 22.2.4, NG-ALAIN/Delon 22.1.1, NG-ZORRO 22.1.2, TypeScript 6.0.3, RxJS 7.8.2. No se modificó package.json: se conservaron todos los rangos del template.
- No venía ningún lockfile. Se generó pnpm-lock.yaml con install --no-frozen-lockfile y luego se validó install --frozen-lockfile. Se habilitó su versionado en .gitignore y se alineó cli.packageManager de Angular con pnpm.
- Node activo inicial 22.14.0 incompatible; pruebas con 22.22.3 ya instalado y PATH de proceso, sin cambiar Node global. .nvmrc conserva 24.20.0. Engine CLI: ^22.22.3 || ^24.15.0 || >=26.0.0.
- Se sorteó la incompatibilidad de launchers pnpm 11/Corepack 0.31.0 con pnpm 12 mediante el bin/pnpm.mjs de 12.6.0. Primera instalación señaló ERR_PNPM_IGNORED_BUILDS por plyr; tras inspeccionar su preinstall, allowBuilds.plyr=false explícito permitió la instalación frozen. No se aprobaron scripts globalmente.
- Advertencias no bloqueantes: bundle inicial producción 2,48 MB > aviso 2 MB (bajo error 6 MB), cinco dependencias CommonJS y husky install deprecado. No se ocultaron avisos ni se cambiaron budgets.
- READMEs de ambas apps documentan comandos reales, layout, menú estático, rutas hash, autenticación Delon y mocks. Propuestas de integración Shell diferenciadas de acuerdos: chrome, prefijos, lifecycles single-spa/zoneless, assets, SSO/refresh, GraphQL y limpieza de efectos globales.
- Evidencias locales: output/angular-verification/_-build.log (marcador BUILD_EXIT=0), logs de instalación/serve y output/playwright/_-dashboard.yml. La captura de pantalla excedió el timeout y no se considera evidencia. No hubo cambios en src, _mock, estilos ni AGENTS locales.

## Histórico — Primera integración Shell + Angular — comprobada

Fecha: 2026-10-25. Implementación local del participante 1, sin CU de negocio. Estrategia y fuentes: docs/decisions/002-shell-angular-single-spa.md. Se conservaron todos los AGENTS.md por SHA-256 y los cambios de la tarea previa; no se creó commit ni se alteró la estructura Git.

- Node seleccionado: **22.22.3**, fijado en los tres .nvmrc. Sustituye 24.20.0 de la línea base inicial porque es compatible y fue efectivamente probado. El Node global 22.14.0 no se cambió.
- Paquetes nuevos fijados: single-spa-angular 22.0.1 (peer Angular >=22 <23) y single-spa 6.0.3. Core Angular 22.2.3 y CLI/build 22.2.4 se mantienen. Runtime ESM standalone/zoneless comprobado; no se ejecutó ng-add porque su schematic migra a custom-webpack. Se conservó @angular/build:application.
- Shell generado con create-vite 9.3.1 vanilla-ts; Vite 8.3.5, TypeScript 6.0.3 y pnpm 12.6.0 exactos, con lockfile. Instalaciones frozen de los tres proyectos: código 0.
- Entradas Angular separadas: main.ts standalone hash con layout/login originales; main.single-spa.ts integrado history, sin chrome del template. Registros @autonexus/employees y @autonexus/operations, prefijos /employees y /operations, recursos /mfs/employees/ y /mfs/operations/.
- CSS del template y CDK overlays dentro del ShadowRoot de cada módulo. Desmontaje destruye aplicación/plataforma propias y limpia su host; no iframe. El Shell controla cabecera, navegación y título del documento. Los márgenes de títulos del template se adaptaron solo dentro del host integrado para evitar overflow móvil.
- Demo explícito: vistas reales de widgets/dashboard del template, mocks de gráficos, sin sesión SSO ni Passport integrado. Logo decorativo local en lugar de una imagen remota y onboarding de la cabecera omitido solo en integrado. Keycloak/CU01 real siguen pendientes.

| Verificación real                                    | Resultado                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------ |
| pnpm install --frozen-lockfile, 3 apps               | Código 0                                                                             |
| pnpm run build:integrated, ambos Angular             | Código 0, exports bootstrap/mount/unmount presentes                                  |
| pnpm run build standalone, ambos Angular             | Código 0                                                                             |
| Shell typecheck / build                              | Código 0 (build incluye tsc, staging y Vite)                                         |
| Shell test                                           | 2 pruebas de rutas, 2 pasan                                                          |
| Navegador Empleados → Operaciones → Empleados        | Mismo performance.timeOrigin; hooks reales; host anterior vacío; una raíz y cabecera |
| Atrás / adelante                                     | Navegación correcta sin recargar documento                                           |
| Enlace directo + reload                              | widgets y dashboard/v1 en ambos prefijos; conserva query string y título del Shell   |
| Assets/chunks/CSS/JSON/favicon                       | Recursos reales HTTP 200 y MIME correcto; sin peticiones simuladas por Playwright    |
| Recurso /mfs/ inexistente                            | HTTP 404, nunca fallback HTML                                                        |
| Prefijo parecido /employees-other                    | No monta MF; mensaje de ruta desconocida                                             |
| Wildcard local /operations/not-available             | Mensaje dentro del módulo, sin redirect global                                       |
| Consola / recursos del recorrido integrado final     | 0 errores, 0 advertencias; 0 respuestas fallidas de recursos                         |
| Widgets escritorio 1440 px / móvil 390 px, ambos MFs | Sin overflow horizontal; una cabecera; ningún CSS /mfs en head del Shell             |
| Standalone en 4201 / 4202                            | Login demo → #/widgets; una cabecera del template y ninguna del Shell                |

Se corrigieron durante verificación: favicon faltante, imagen externa, tutorial dependiente del layout, campo TS del modo integrado, márgenes negativos de título móvil y escritura asíncrona de Title de Delon. La revisión independiente encontró un mensaje de error persistente tras recuperarse una carga; se limpia al reintentar y al montar correctamente. No quedaron bloqueantes del recorrido requerido. La recuperación ante fallos transitorios no se provocó artificialmente como evidencia de integración.

Advertencias conservadas: bundle inicial standalone 2,48 MB e integrado ~2,92 MB frente al aviso de 2 MB, bajo error de 6 MB; CommonJS y Husky deprecado. El Shell añade ~21,23 kB de JS propio (no incluye el peso de los MFs copiados). No se cambiaron budgets ni versiones Angular para ocultarlas.

Comandos y condiciones de reproducción en web/shell/README.md y ambos README Angular. Logs finales en output/shell-integration/ (builds con EXIT=0, instalaciones, pruebas y scripts/resultados de navegador); capturas output/playwright/shell-{employees,operations}-{desktop,mobile}.png. Los logs *-intermediate.log registran una iteración fallida corregida, no resultados finales.

Servidores locales al cierre: Shell preview en 127.0.0.1:4200; standalone en 4201/4202. Sesiones de navegador automatizado cerradas al terminar. Staging sirve copias generadas: tras cambiar un MF, reconstruirlo y volver a stagear/construir el Shell; no hay HMR cruzado prometido. No se desplegó a hosting externo ni se probó todo el catálogo demo.

## Histórico — Organización Git vigente

El 2026-10-25 Marcelo indicó usar un único monorepositorio en `autonexus-ai`. Se inicializó la raíz en `main` y se configuró `origin=https://github.com/marcelojp03/autonexus-ai.git`, sin push. Se confirmó que los dos `.git` Angular pertenecían a NG-ALAIN, no a AutoNexus, y se retiraron a la Papelera con autorización; fuentes/AGENTS/lockfiles preservados. El `.gitignore` raíz excluye dependencias/builds/cachés, entornos reales, secretos, datos locales y artefactos de verificación, conservando lockfiles y ejemplos. Ver decisión 003. Las referencias anteriores a falta de Git son históricas.

## Histórico — Base backend MS01/MS02 — técnica terminada y revisada

Fecha: 2026-10-25. Rama feat/backend-foundation, worktree .worktrees/backend-foundation, base main7bc80a7. Especificación aprobada: docs/compose/spec/backend-foundation.md; decisión004. Sin merge/push automático ni CU de negocio terminado.

- Operaciones: Boot 4.1.2/JDK 21.0.8, Wrapper 3.3.4/Maven 3.10.0, Flyway 12.4.0/JDBC 42.7.14. Initializr oficial, raíz correcta y AGENTS preservado. Build final:12 tests sin fallos/errores/omitidas. Regresión de configuración aislada red(2fallos)→green; no se leyó .env ni se repitió el arranque sin contraseña bloqueado al actor.
- Empleados: Nest 12.2.0/CLI 12.0.10, Node 22.22.3/pnpm 12.6.0, TypeORM 1.1.2/@nestjs/typeorm 12.0.2/pg 8.23.1, TypeScript 6.0.3/Vitest 4.1.12. Generador oficial skip-git/no-observe. Frozen/build,13 unitarias+3 HTTP y lint pasan; lockfile versionado.
- Casos técnicos y puertos puros separados de adaptadores SQL/HTTP/Actuator y composición. Sin dominio ficticio ni capas vacías de negocio. No se generaron otros servicios ni se modificaron versiones/fuentes frontend.
- Compose propio autonexus-backend-dev, imagen postgres:17.11-bookworm, bind127.0.0.1:55432 y volumen exclusivo. Dos bases/roles autonexus_operations/autonexus_employees sin privilegios elevados. Cada rol conecta a su base y recibe tres rechazos42501: base ajena, postgres ytemplate1. No se detuvieron contenedores ajenos.
- Tres .env privados con secretos aleatorios distintos, ignorados por Git; ejemplos vacíos versionados. Segunda inicialización rechazada sin modificar archivos. Nunca se imprimen passwords ni se pasan por URL/argumentos.
- Migraciones reales: schemas operations/employees e historiales public.flyway_schema_history/public.employees_migrations; una versión por servicio y segunda ejecución no-op. Sin tablas de negocio ni synchronize.

| Verificación real          | Resultado                                                                |
| -------------------------- | ------------------------------------------------------------------------ |
| Operaciones 127.0.0.1:8081 | /actuator/health/liveness y /actuator/health/readiness                   |
| Empleados 127.0.0.1:3002   | /health/live y /health/ready                                             |
| DB disponible              | Ambos live200UP/ready200UP                                               |
| DB propia detenida         | Ambos live200UP/ready503DOWN                                             |
| DB restaurada              | Ambos live200UP/ready200UP, sin reiniciar apps                           |
| Cuerpos HTTP               | Solo status; sin SQL, password, host, usuario o stacks                   |
| Frontend                   | Shell4200 navega y recarga; MF4201/4202 login demo;0 errores JS/recursos |

Mismos PID/hora de inicio Java/Node durante caída/restauración. El verificador valida ownership por nombre/proyecto/servicio/working_dir y restaura en finally. Fakes de unidades no sustituyen la integración real. Avisos no bloqueantes: metadata de feeds auxiliares Flyway401 y Mockito/Byte Buddy; sin añadir credenciales ni ocultarlos. Java global8/javac23/Node global22.14 no se modificaron.

README por servicio/infra con comandos reales para configurar, instalar, compilar, migrar, ejecutar y verificar. Evidencia local ignorada: output/backend-foundation (build/tests, migraciones, aislamiento, health-outage, frontend-browser). Revisión independiente de7bc80a7..6027fce: cumplimiento, corrección y consistencia conformes;0críticos. Se reactivaron después los procesos propios: PostgreSQL healthy, Ops8081/Empleados3002live/ready200 y frontends4200/4201/4202HTTP200. El script no compara PID automáticamente: la identidad durante caída fue comprobada por el principal. Especificación delivered con evidencia y tareas completas; cierre Git local sin merge/push automático.

## Histórico — Integración local de backend-foundation en main

El 2026-10-25, por instrucción de Marcelo, main avanzó por fast-forward de7bc80a7 a3bbf499; feat/backend-foundation y su worktree se conservaron, sin push. Las tres configuraciones privadas se copiaron a la carpeta principal con creación exclusiva/comparación byte a byte, sin regenerar contraseñas. Se recompiló allí: Maven12tests PASS; Empleados frozen/build,13unitarias+3HTTP PASS. Los primeros intentos de consola excedieron60s y no se acreditan; verificaciones desacopladas terminaron con exit0.

El contenedor PostgreSQL propio fue recreado para que bind/config/ownership apunten a infra/compose de la raíz principal. Se comprobó el mismo volumen autonexus-backend-dev_postgres-data, credenciales conservadas y una migración por servicio. El verificador de raíz pasó caída/restauración200→503→200 con mismos PID/hora de inicio; el verificador del worktree anterior rechazó ownership antes de mutar. La ejecución definitiva de esta base está en la raíz; el worktree se conserva como fuente histórica, no como dueño runtime. Evidencia local: output/backend-main-integration. CU01/Keycloak siguen pendientes de la siguiente rama.

## Histórico — CU01 web local — feat/cu01-keycloak

La base permanece integrada en main1963ce3. CU01 queda entregado localmente en .worktrees/cu01-keycloak, rama feat/cu01-keycloak, base main1963ce3; contratos682bfeb, implementación0a8bd2f y corrección86d81af. Revisión integral y re-revisión afectada conformes en especificación/corrección/consistencia: C1/NC1 cerrados, cero críticos pendientes. Especificación delivered con rango revisado1963ce3..86d81af, excluyendo el commit documental final. No se hizo push, reset, borrado de ramas/worktrees ni merge automático de CU01. Todos los AGENTS se preservan.

Runtime de esta entrega: código de servicios y web desde el worktree CU01; PostgreSQL de aplicación administrado desde infra/compose de la raíz principal, con mismo volumen y credenciales. Las dos configuraciones privadas CU01 coinciden byte a byte con main. IdP propio administrado desde infra/keycloak del worktree, proyecto autonexus-keycloak-dev y volumen autonexus-keycloak-dev_idp-postgres-data; no usa las bases de Operaciones/Empleados. No administrar el PostgreSQL compartido con el verificador de un worktree anterior.

Keycloak26.8.1/PostgreSQL17.11 propios; keycloak-js26.2.4 y jose6.2.13 exactos. Se mantienen Node22.22.3/pnpm12.6.0, Boot4.1.2/JDK21.0.8, Nest12.2.0 y Angular22/Delon del lockfile. Servidor y SDK tienen minor distinto legítimo, comprobado sin cambiar versiones por suposición. HTTP/start-dev loopback no acredita producción/TLS.

Shell es propietario de una sola sesión OIDC Code+PKCE S256, nonce/state y refresh en memoria. Pasa SessionPort, no JWT/refresh/ID tokens. Los Angular integrados no crean SDK, fallan cerrados si falta sesión y mantienen prefijos/CSS/ShadowRoot/chrome único. Standalone4201/4202 tiene cliente OIDC explícito y layout completo. Demo solo con entrada/configuración dedicadas, Delon en memoria y sin APIs protegidas. Passport ficticio/ACL completa quedan limitados al demo, no al modo normal OIDC.

APIs RS256/JWKS confiable, issuer/audiencia propios, exp/sub/typ obligatorios, tolerancia5s y políticas servidor; salud pública conserva SQL real. /technical/session permite roles reconocidos; /technical/admin exige administrador. Solo diagnósticos REST: funciones empresariales web siguen reservadas a GraphQL/BFF. Semilla de cinco roles/siete cuentas sintéticas no implementa CU02 ni crea empleados.

| Verificación ejecutada | Evidencia observada |
| --- | --- |
| Operaciones clean verify | PASS46 tests; Security7.1.2/Nimbus10.9.1; 12 base+20 RSA/JWKS sintéticos+14 MVC explícitamente falsos |
| Empleados frozen/build/test/test:e2e/lint/tsc | PASS40 unitarias+32 HTTP; lint0 errores/advertencias |
| Angular, ambos | Frozen/tipos/2 pruebas de política cada uno PASS; seis builds producción: integrado/OIDC/demo con EXIT0 |
| Shell frozen/test/build | PASS15 unidades; staging final y hashes main.js coinciden con los bundles Angular finales |
| Regresión G2 del template | Red reproduce ObjectUnsubscribedError tras destroy; green6/6 cada Angular con servicio real y loader sintético; parche pnpm22.1.1 sin upgrade; navegación rápida posterior sin errores Angular |
| Cargador PowerShell | Red rechaza OIDC documentado→green3/3 con fixtures temporales; permite tres claves públicas y mantiene rechazo de desconocidas, sin .env reales |
| IdP config/verify/idempotency/persistence | PASS6 tests; clientes/orígenes/PKCE/mappers reales; mismos bytes privados e IDs tras reprovisión/restart de Keycloak |
| APIs con Keycloak real | PASS10 grupos: salud/CORS,401 sin token/inválido, credenciales erróneas/deshabilitada,200/403 roles, rechazo IDtoken/firma alterada, refresh real, logout y expiración |
| PostgreSQL propietario | Roles sin privilegios; tres rechazos42501 por rol; una migración cada servicio; readiness200→503→200 y live200, mismos PID/StartTime sin reiniciar apps |
| Navegador real final | PASS12 etapas funcionales, Node exit0: Code/PKCE/retorno, navegación sin reload/login, reload SSO, refresh real, diagnósticos200/403, standalone4201/4202, logout/nuevo login, sin rol sin bucle y demo4203 sin bearer |
| Consola/recursos/almacenamiento | 0 pageErrors/errores inesperados/recursos fallidos/PKCE inválido/tokenFailures; 2 errores403 deliberados contados aparte; sin tokens en localStorage/sessionStorage/IndexedDB |

Se capturaron y verificaron desktop1440/mobile390 con identidad/diagnósticos enmascarados, una cabecera y sin overflow al capturar. La repetición final posterior al parche de ciclo de vida reutiliza explícitamente esos PNG: no cambió la presentación y no se acredita otra ronda visual. Playwright1.64.1/Chromium1248 provienen del lockfile; se instaló el ejecutable faltante sin actualizar paquetes. El verificador corrigió selectores reales de Keycloak/Delon y el formato Locator[] de máscaras; esos intentos no se contaron como PASS. El error real G2 se reprodujo y corrigió, no se clasificó como ruido.

Primera revisión independiente1963ce3..0a8bd2f: C1 detectó propietario destruido tras restauración BFCache y NC1 el README del Shell obsoleto. C1 se corrige recargando solo pageshow.persisted; NC1 diferencia fase histórica y cierre global. Regresión scripts/verify-cu01-bfcache.mjs --synthetic-events: red conserva documento/propietario muerto, green crea documento nuevo y llega al IdP sin credenciales. Es simulación explícita de eventos con recarga/navegación reales, no prueba de hit nativo BFCache: Chromium lo denegó con notRestoredReasons=masked. Tras el cambio, Shell15 unidades/build y SSO real12 etapas volvieron a PASS, con0 errores inesperados y2x403 intencionales. Re-revisión0a8bd2f..86d81af cerró ambos hallazgos; no repitió suites por rutina ni activó apps durante revisión.

Al cierre se reactivaron seis procesos propios y tres contenedores, sin recrear volúmenes ni regenerar configuraciones. final-smoke.json PASS/exit0: live/ready200 y protegidos anónimos401 en ambos servicios, issuer correcto, web4200/4201/4202/demo4203 HTTP200, assets de módulos200/inexistente404. PostgreSQL mantiene aislamiento y una migración por servicio en la comprobación repetida. Los PID iguales corresponden al ensayo de caída, no a antes/después de las pausas planificadas de revisión.

Access local60s. Logout invalida cliente/sesión IdP/refresh, pero un access token real emitido siguió200 y después recibió401 en ambos servicios tras exp+tolerancia. No se promete revocación instantánea de JWT offline. Credenciales/tokens solo en RAM de verificadores; no se publican bodies, Authorization ni URLs OAuth. Los fixtures privados y output están ignorados.

Evidencia local: output/cu01-keycloak/{backend-verification.json,operations-build.log,employees-unit.log,employees-http.log,api-real.log,health-outage.log,browser-real.log}; API/browser/health .exit=0. Builds finales con parche: g2-{red,green,build}-results.json y logs por app/modo; seis builds exit0 y tests reales del servicio en Chromium6/6 cada app. IdP: infra/keycloak/.local/*.result.json/log con PASS/exitCode0; no publicar archivos privados. Capturas sanitizadas output/playwright/cu01-{desktop,mobile}.png. Ejecución/puertos/comandos completos en scripts/cu01/README.md. ESLint global Angular adicional no se acredita: excedió el timeout; no se presenta como PASS ni se ocultaron budgets/CommonJS y warnings de módulos Node.

## Histórico — Pendiente

- Identificar participantes 2 y 3 por nombre.
- Inicializar y verificar Finanzas, Inteligencia, Sincronización y aplicaciones de integración restantes cuando sus responsables/CU lo requieran. Operaciones y Empleados ya tienen base técnica terminada y revisada; CU03 backend está implementado/verificado en su rama; los demás CU siguen su estado explícito.
- Completar BFF GraphQL y funciones empresariales mediante contratos por CU. CU01 web ya está integrado localmente en main; los gráficos siguen siendo ejemplos, no CRUD ni integración empresarial.
- Crear contratos, infraestructura ejecutable y configuración.
- Implementar y probar CU15, IA, offline, sincronización, MCP y demás funciones.

## Histórico — Siguiente entregable

Acordar matriz de permisos empresariales para CU02 y contrato BFF del participante2: audiencia propia, forwarding/exchange autorizado, validación issuer/firma/exp y rol/acción/registro por campo/CU. El SessionPort y los cinco roles técnicos están versionados, no sustituyen esas políticas. Flutter/offline de CU01 y CU15 permanecen pendientes.

## Histórico — Evidencia

No se ha integrado ni probado una plataforma AutoNexus completa ni todos sus CU. La base backend está en main; esta rama incorpora CU01 web local real y distingue explícitamente sus pruebas de las demos históricas. En el cierre histórico de CU01 no se acreditaban Flutter, offline autorizado, CU02, CRUD, BFF, Saga ni producción; CU03 backend posterior se registra en la cabecera vigente. El callback ficticio y ACL completa solo pueden ejecutarse en la entrada demo dedicada; compilar/probar ese modo no lo convierte en autenticación válida.

## Histórico — Próxima actualización

Registrar fecha, rama/commit, cambios implementados, verificaciones reales, bloqueos y siguiente paso. No reemplazar pendientes por porcentajes estimados sin evidencia.

C1 residual en re-revisión5e1f5cc: U+212A se convertía en k antes de verificar ASCII. Dos regresiones en rojo; control de alfabeto movido antes de toLowerCase, preservando trim/espacios. Ronda posterior70unitarias/42HTTP PASS, dominio final27/27, build/tipos exit0 y lint0advertencias. Funcional real final9grupos/exit0 incluye ambos casos Unicode en HTTP; no se repitieron outage/sesiónSQL no afectados (15grupos anteriores conformes). Referencia al log histórico ausente corregida sin fabricar artefactos. Pendiente confirmación independiente de este último límite.


Prueba acotada de reintento de acceso (2026-10-27): `scripts/cu03/verify-access-retry-web.mjs` PASS 7 etapas/exit0. Crea un empleado con acceso, deshabilita su cuenta en Keycloak mediante el cliente técnico, provoca el fallo de sincronización por la API propietaria (setup, no la interfaz bajo prueba), abre la ficha en el navegador con sesión real, comprueba estado fallido + botón de reintento, reintenta mientras la cuenta sigue deshabilitada (se registra el intento) y, tras habilitar la cuenta por vía autorizada, reintenta y verifica el estado `synced` con subject estable y desaparición del botón. Consola limpia. Detectó y corrigió que la ficha mostraba el snapshot previo a la sincronización; ahora relee el empleado tras el reintento.

Revisión del commit final `fe78fe9`: el sistema de agentes siguió bloqueado por SQLite, por lo que se realizó una **revisión directa focalizada** del diff (no independiente). Confirmó el guard de reenvío, la normalización de especialidades, la eliminación del bloque duplicado del Shell, el traslado del reintento fuera de `nz-alert` y la alineación documental; no halló regresiones. La diferencia de método queda registrada aquí.
## Histórico — CU04 — Horarios y disponibilidad entregados (2026-10-27)

Rama `work/marcelo`. Backend en Empleados, BFF y pantalla NG-ALAIN integrados. No se modificó el CRUD de CU03.

- Migración `1793109000000` crea `employee_shifts`, `employee_absences`, `employee_assignments` (solo lectura para CU04) , `staffing_operations` y `staffing_audit` en el schema propio. Aplicada con rol propietario; segunda ejecución no-op.
- REST `/staffing/*` con política explícita administrador + jefe_taller; `/employees*` sigue administrador-only. Proyección `GET /staffing/employees` solo id, nombre, cargo y estado.
- Reglas: empleado activo, turnos sin superposición, descanso dentro del turno, ausencias sin superposición, conflicto con asignaciones confirmadas con reconocimiento explícito, `operationId` idempotente, `expectedVersion` y desactivación conservando historial y auditoría. Zona `America/La_Paz`; sin cruce de medianoche (límite documentado).
- BFF: SDL `contracts/graphql/schedules.graphql` con `extend type Query/Mutation`, allowlist ampliada, política por campo raíz y códigos de error CU04. El guard autentica y ya no impone administrador global: cada campo decide.
- UI: `/employees/schedules` con búsqueda de personal, turnos, descansos, ausencias y disponibilidad del día; enlace en la navegación del Shell.

| Verificación | Resultado |
| --- | --- |
| API real CU04 (`scripts/cu04/verify-scheduling-real.mjs`) | PASS 11 etapas/exit0 |
| BFF unitarias + HTTP | PASS 11 + 11, build exit0 |
| Navegador CU04 (`scripts/cu04/verify-schedules-web.mjs`) | PASS 8 etapas/exit0 (jefe de taller) |
| Regresión CU03 (`verify-cu03-web.mjs`) | PASS 11 etapas/exit0 |
| Smoke CU01 API desde raíz | PASS 10 comprobaciones/exit0 |

La API real cubre 401/403 por rol, proyección mínima, alta con descanso, solapamiento, validaciones de horas, planificación por jefe, disponibilidad sin descanso, ausencia que bloquea el día, conflicto con asignación confirmada y reconocimiento, desactivación con versión e idempotencia, lectura de horario, auditoría e inactividad rechazada. El smoke de navegador usa Keycloak, BFF, Empleados y PostgreSQL reales; el turno creado desde la interfaz aparece con su descanso excluido de la disponibilidad.

Contratos y decisiones: `contracts/rest/staffing.md`, `contracts/graphql/schedules.graphql`, `docs/decisions/011-cu04-scheduling.md`, especificación `docs/compose/spec/cu04-schedules.md`.

Límites: no hay alta de asignaciones ni Saga CU15 (solo la tabla y la regla de conflicto), ni CU05, CU02, reasignación, feriados, nómina, offline o turnos que crucen medianoche. El primer push de CU03 sí se publicó (`main` y `work/marcelo` en `a22032c`); CU04 todavía no está publicado.
Revisión de CU04: el revisor independiente volvió a quedar bloqueado (sesión sin actividad tras el arranque; cancelada). Se realizó **revisión directa focalizada** del rango a22032c..032d111, declarada como tal y no como independiente. Comprobado: política por campo raíz con `employees*` solo administrador y `staffing*` administrador/jefe; guard que solo autentica y autorización por campo con default deny (la allowlist rechaza campos fuera de política); `@RequireRoles('administrador','jefe_taller')` en el controlador de planificación sin cambios en el de empleados; validación de orden de horas, descanso dentro del turno y exclusión del descanso en la disponibilidad; migración versionada con constraints; conflicto con asignaciones confirmadas sobre la tabla real y reconocimiento auditado. Sin hallazgos críticos en esta revisión directa. Persisten como límites declarados: sin alta de asignaciones ni Saga CU15, sin turnos que crucen medianoche y sin CU02/CU05.

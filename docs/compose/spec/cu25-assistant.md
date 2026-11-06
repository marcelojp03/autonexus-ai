---
feature: cu25-assistant
status: in-progress
updated: 2026-11-06
source: work/marcelo
---

# CU25 — asistente empresarial interno de consulta

## Report

## [S1] Problem

El taller necesita consultar órdenes, agenda y avances en lenguaje natural sin que el empleado
navegue varias pantallas y sin que un modelo pueda ampliar permisos. CU29 ya expone seis consultas
por MCP; falta el agente interno que las seleccione y responda con datos reales.

## [S2] Design

### [S2.1] Frontera

`integration/agent` es un proceso interno independiente. El servidor MCP no aloja agentes y el
agente funciona también **sin** MCP mediante un camino REST propio: la fuente de herramientas es
intercambiable y el planificador no conoce el transporte.

### [S2.2] Identidad y permisos

Cada consulta se ejecuta con una identidad sintética delegada: MCP usa PKCE con
`autonexus-mcp-local-reader`; el camino REST usa el cliente confidencial `autonexus-n8n-reader`. El
catálogo de herramientas se descubre con el token real —el catálogo REST se deriva de los roles del token— y el propietario revalida permiso y registro
en cada llamada. El agente no reutiliza ni imprime tokens.

### [S2.3] Planificación y respuesta

Pasada de seguridad (escritura, roles, permisos, envíos, SQL, cambio de rol) → rechazo explícito.
Después, intención por palabras clave → exactamente una herramienta autorizada, con ventana de
agenda de 7 días en `America/La_Paz`. Si falta un identificador, se pide; no se inventa. La
respuesta se compone solo con campos conocidos del resultado y declara la fuente; un fallo del
propietario se informa como error, nunca como lista vacía.

### [S2.4] Datos no confiables

El texto devuelto por una herramienta es dato: el planificador no lo interpreta como instrucción ni
lo usa para elegir otra herramienta o ampliar alcance.

### [S2.5] Auditoría

Una línea por consulta con actor, fuente, herramienta, resultado y duración. La consulta se guarda
como SHA-256 y longitud (es texto libre y puede contener datos personales); nunca tokens ni cuerpos.

## [S3] Out of Scope

Escrituras de negocio (CU30), administración web de clientes (CU31), generación de reportes (CU26),
modelos de lenguaje o entrenamiento, notificaciones y despliegue cloud. El alcance REST del
asistente cubre órdenes, agenda de equipo y ejecución de equipo; las variantes propias se ejercitan
por MCP.

## Tasks

- [x] T1: Fuente MCP de herramientas con identidad delegada — acceptance: catálogo real y llamadas autorizadas (covers: S2.1,S2.2).
- [x] T2: Camino REST sin MCP — acceptance: misma consulta responde con MCP detenido (covers: S2.1).
- [x] T3: Planificador seguro y determinista — acceptance: rechazos de permisos/escritura y selección de herramienta con pruebas (covers: S2.3,S2.4).
- [x] T4: Respuesta basada en datos reales y auditoría — acceptance: ejecución real con conteos verificables y auditoría sin secretos (covers: S2.3,S2.5).

# 031 — Borrador ligado al trabajo y preparación editable

Fecha2026-11-08. Ampliación técnica de offline-sync S2.10–S2.12, sin cambio
académico, de modelo o de reglas de sincronización.

- Un borrador PWA no cambia de asignación al mover el selector. Cancelar conserva
  trabajo/materiales; descarte explícito limpia antes de adoptar el siguiente.
  No se crea un sistema nuevo de borradores persistentes por trabajo en este
  incremento; la cola ya guardada y sus operationId siguen intactos.
- Un cambio durante hash invalida el guardado; refrescar la lista no adscribe
  un borrador huérfano al primer trabajo restante.
- Flutter prepara sólo ejecuciones in_progress revalidadas con asignación/cuenta
  coherentes; status ausente no habilita edición. Copia/cola previas no se borran.
- Descripción y minutos requieren entrada deliberada, sin cifras/textos de
  negocio plausibles precargados. Errores junto al campo y foco conservan
  Material y los insets nativos; guardado local no confirma al servidor.
- Se distingue regresión técnica de nueva aceptación visual/física; se conserva
  la aceptación anterior CU22/CU27 y su modelo/licencia siguen en dimensiones
  separadas. Evidencia en offline-workspace-ux-20261108; sin puntos nuevos.

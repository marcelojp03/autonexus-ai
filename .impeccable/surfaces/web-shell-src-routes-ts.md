---
version: 1
slug: "web-shell-src-routes-ts"
primary_target: "web/shell/src/routes.ts"
related_targets: ["web/shell/src/main.ts","web/mf-employees/src/main.ts","web/mf-operations/src/main.ts","web/mf-finance/src/main.jsx","web/mf-intelligence/src/main.jsx"]
---

## Direction contract

THESIS: AutoNexus is a set of role-authorized workshop workspaces, not a sequence every employee traverses. Navigation derives from permissions; after login, one permitted MFE opens directly and multiple permitted MFEs lead to a chooser.

OWN-WORLD: Use workshop service-route wayfinding as the visual source: restrained, functional route colors, clear typographic hierarchy, and compact status markers that connect work steps. Keep ordinary accessible web navigation, forms, and tables; no terminal, cockpit, map, or control-panel costume. Status colors mean only real states.

STORY: Staff reach the authorized workspace for their job and understand the next actionable work item and its truthful state. The mechanic's separate mobile route is assigned jobs → execute → record evidence → sync; it is not a client portal.

FIRST VIEWPORT: Shell begins with login when unauthenticated. Once authenticated, a single authorized destination opens directly; with several, show a clear workspace chooser. Inside each workspace, retain familiar navigation, a task-specific heading, the primary action, and real empty/loading/error/success states. Never fabricate dashboard metrics.

FORM: User-pinned grounded service-route direction, applied to Shell and all four MFEs; Operate, code-led. Reference: seed:3da53f957ae2788b.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

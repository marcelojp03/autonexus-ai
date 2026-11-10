# AutoNexus Operations Interface Patterns

## Product direction

AutoNexus is a workshop workbench for service advisors, mechanics, and workshop managers. The interface should make operational state legible quickly without making historical records look like current work.

- **Intent:** help an employee identify a vehicle, review a prior intervention, and retrieve its recorded services or evidence.
- **Density:** calm and information-dense; prioritize scanability over decorative space.
- **Hierarchy:** vehicle identity anchors the page; dated interventions lead; recorded service details and evidence appear on demand.
- **Signature:** a chronological intervention summary that expands into the exact service snapshot recorded for that work order.

## Domain vocabulary and visual references

Use the domain's own language: vehicle, work order, reception, intervention, recorded service snapshot, and evidence.

The physical workshop suggests the existing palette's material references: enamel white and light neutral surfaces, graphite text, steel-gray structure, workshop blue for primary actions, and amber/red/green for meaningful operational states. These are semantic references, not permission to introduce new raw color values. Reuse the existing NG-Zorro theme and semantic tokens.

## Existing component language

- Reuse NG-Zorro components, the current light-neutral surfaces, and existing button, table, form, and status patterns.
- Keep toolbar and compact control spacing aligned with the existing 12px rhythm; use the surrounding component's established spacing for larger groups.
- Preserve the current typography and let weight, contrast, and spacing carry hierarchy. Do not add a new font or a parallel token system for one screen.
- Prefer quiet surface shifts and existing separators over decorative borders or shadows.
- Use semantic status colors only when a value represents a real operational status.

## Vehicle service history

- Separate service history from vehicle-owner history. A change of owner is not an intervention.
- Preserve the service name and category recorded when the work order was created; do not relabel past work from the current catalog.
- Order interventions by recorded date and show their actual order/execution status. Never imply a reception or pending order was completed.
- Display observations and diagnostic details only within the authorized intervention detail.
- Represent evidence with a clear available, unavailable, or not-downloaded state. Never display S3 object keys or signed URLs.
- For an offline snapshot, show when it was downloaded and make its potentially stale state explicit. Do not label cached history as current or recently verified.

## Required states and accessibility

Every history view needs loading, populated, empty, not-found, forbidden, unavailable, and offline/stale states as applicable. Keep those states distinct; a permission failure is not an empty history.

Use semantic buttons and links, visible keyboard focus, meaningful accessible names, and status text that does not rely on color alone. Preserve the existing responsive behavior rather than introducing a separate mobile visual language.

## Avoid

- Mixing owner changes, appointments, and service interventions into one ambiguous timeline.
- Generic metric cards or decorative charts where a dated intervention list is the useful representation.
- Treating a downloaded offline copy as live data.
- Exposing private evidence identifiers, storage locations, credentials, or temporary download URLs.
- Adding a new palette, typography system, or component framework beside the existing MF02 patterns.

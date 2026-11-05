/// Screens of the offline journey: session, prepared works and the pending queue.
///
/// The screen never says "guardado en el servidor" for something that is only local, and never hides
/// a rejection behind a generic error: each state has its own sentence and its own next action.
library;

import 'package:flutter/material.dart';

import '../offline/offline_models.dart';
import '../inference/inspection_page.dart';
import 'journey_controller.dart';
import 'work_page.dart';

class JourneyHome extends StatelessWidget {
  const JourneyHome({super.key, required this.controller});

  final JourneyController controller;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final snapshot = controller.snapshot;
        final subject = snapshot.subject ?? controller.localSubject;
        return Scaffold(
          appBar: AppBar(
            title: const Text('AutoNexus · Taller'),
            actions: [
              IconButton(
                tooltip: 'Inteligencia visual (CU22)',
                icon: const Icon(Icons.camera_alt_outlined),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const InspectionPage()),
                ),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _SessionCard(controller: controller),
              const SizedBox(height: 12),
              if (controller.notice != null)
                _Banner(text: controller.notice!, tone: _Tone.info),
              if (controller.lastError != null)
                _Banner(text: controller.lastError!, tone: _Tone.error),
              if (controller.recovered > 0)
                _Banner(
                  text:
                      '${controller.recovered} operación(es) quedaron en envío al cerrarse la app; se reintentarán con el mismo identificador.',
                  tone: _Tone.warning,
                ),
              const SizedBox(height: 12),
              if (subject == null)
                const _Empty(
                  text: 'Iniciá sesión para descargar un trabajo autorizado.',
                )
              else ...[
                _WorksCard(
                  controller: controller,
                  subject: subject,
                  authenticated: snapshot.authenticated,
                ),
                const SizedBox(height: 12),
                _QueueCard(
                  controller: controller,
                  authenticated: snapshot.authenticated,
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}

class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.controller});

  final JourneyController controller;

  @override
  Widget build(BuildContext context) {
    final snapshot = controller.snapshot;
    final hasLocalCopy = controller.localSubject != null;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              snapshot.authenticated ? 'Sesión activa' : 'Sin sesión',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              snapshot.authenticated
                  ? '${snapshot.name ?? snapshot.subject} · roles: ${snapshot.roles.isEmpty ? 'ninguno' : snapshot.roles.join(', ')}'
                  : hasLocalCopy
                  ? 'Copia local disponible. Podés consultar el trabajo y guardar avances; sincronizar exige sesión vigente.'
                  : 'La sesión es necesaria para descargar el trabajo autorizado.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                if (!snapshot.authenticated)
                  FilledButton.icon(
                    key: const Key('sign-in'),
                    onPressed: controller.busy ? null : controller.signIn,
                    icon: const Icon(Icons.login),
                    label: Text(
                      hasLocalCopy ? 'Restablecer sesión' : 'Iniciar sesión',
                    ),
                  ),
                if (snapshot.authenticated)
                  OutlinedButton.icon(
                    key: const Key('sign-out'),
                    onPressed: controller.busy ? null : controller.signOut,
                    icon: const Icon(Icons.logout),
                    label: const Text('Cerrar sesión'),
                  ),
                if (snapshot.authenticated)
                  OutlinedButton.icon(
                    key: const Key('choose-agenda-day'),
                    onPressed: controller.busy ? null : () async {
                      final day = await showDatePicker(
                        context: context,
                        initialDate: controller.agendaDay,
                        firstDate: DateTime(2020),
                        lastDate: DateTime(2100),
                        helpText: 'Elegir día del trabajo (taller)',
                      );
                      if (day != null) await controller.chooseAgendaDay(day);
                    },
                    icon: const Icon(Icons.calendar_today_outlined),
                    label: Text('Día ${controller.agendaDay.year}-${controller.agendaDay.month.toString().padLeft(2, '0')}-${controller.agendaDay.day.toString().padLeft(2, '0')}'),
                  ),
                if (snapshot.authenticated)
                  FilledButton.tonalIcon(
                    key: const Key('fetch-works'),
                    onPressed: controller.busy
                        ? null
                        : controller.fetchAvailable,
                    icon: const Icon(Icons.cloud_download_outlined),
                    label: const Text('Descargar trabajos autorizados'),
                  ),
              ],
            ),
            if (snapshot.authenticated && controller.available != null) ...[
              const SizedBox(height: 8),
              ...controller.available!.map(
                (item) => ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text('${item.orderNumber} · ${item.vehiclePlate}'),
                  subtitle: Text(
                    '${item.description} · ejecución ${item.executionStatus} · ${item.advances} avance(s)',
                  ),
                  trailing: TextButton(
                    key: Key('prepare-${item.assignmentId}'),
                    onPressed: controller.busy
                        ? null
                        : () => controller.prepare(item),
                    child: const Text('Preparar'),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _WorksCard extends StatelessWidget {
  const _WorksCard({
    required this.controller,
    required this.subject,
    required this.authenticated,
  });

  final JourneyController controller;
  final String subject;
  final bool authenticated;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Trabajos en la copia local',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              'Cuenta $subject',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            if (controller.works.isEmpty)
              const _Empty(
                text: 'Todavía no hay trabajo preparado en este dispositivo.',
              )
            else
              ...controller.works.map((work) {
                final usable = work.isUsableAt(DateTime.now().toUtc());
                return ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(work.orderNumber),
                  subtitle: Text(
                    usable
                        ? 'Versión ${work.version} · preparado el ${work.preparedAt.toLocal()}'
                        : 'Preparación vencida: revalidá con conexión antes de sincronizar (versión ${work.version}).',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          WorkPage(controller: controller, work: work),
                    ),
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

class _QueueCard extends StatelessWidget {
  const _QueueCard({required this.controller, required this.authenticated});

  final JourneyController controller;
  final bool authenticated;

  @override
  Widget build(BuildContext context) {
    final pending = controller.queue
        .where((item) => !item.state.isTerminal)
        .length;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Cola de sincronización',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              '$pending pendiente(s) · ${controller.queue.length} en total',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              key: const Key('sync'),
              onPressed: !authenticated || controller.busy
                  ? null
                  : controller.syncNow,
              icon: const Icon(Icons.sync),
              label: Text(
                authenticated
                    ? 'Sincronizar pendientes'
                    : 'Sincronizar (requiere sesión)',
              ),
            ),
            const SizedBox(height: 8),
            if (controller.queue.isEmpty)
              const _Empty(text: 'Sin avances guardados en este dispositivo.')
            else
              ...controller.queue.map(
                (advance) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    advance.description,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  subtitle: Text(
                    '${advance.minutesWorked} min · ${queueProgressLabel(advance)}'
                    '${advance.lastCode == null ? '' : ' · ${advance.lastCode}'}'
                    '${advance.attempts == 0 ? '' : ' · intentos ${advance.attempts}'}',
                  ),
                  trailing: _StateChip(state: advance.state),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _StateChip extends StatelessWidget {
  const _StateChip({required this.state});

  final QueueState state;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final (label, color) = switch (state) {
      QueueState.pending => ('Pendiente', scheme.tertiaryContainer),
      QueueState.sending => ('Enviando', scheme.secondaryContainer),
      QueueState.applied => ('Confirmado', scheme.primaryContainer),
      QueueState.conflict => ('Conflicto', scheme.errorContainer),
      QueueState.rejected => ('Rechazado', scheme.errorContainer),
      QueueState.needsReupload => ('Nueva carga', scheme.tertiaryContainer),
    };
    return Chip(label: Text(label), backgroundColor: color);
  }
}

String queueLabel(QueueState state) => switch (state) {
  QueueState.pending => 'guardado local, sin enviar',
  QueueState.sending => 'envío en curso o interrumpido',
  QueueState.applied => 'confirmado por el servidor',
  QueueState.conflict => 'el trabajo cambió: revisá y volvé a intentar',
  QueueState.rejected => 'el servidor lo rechazó',
  QueueState.needsReupload => 'la autorización de carga venció',
};

String queueProgressLabel(QueuedAdvance advance) {
  if (advance.state.isTerminal || advance.state == QueueState.needsReupload) {
    return queueLabel(advance.state);
  }
  if (advance.evidenceState == 'available' &&
      advance.modelVersion != null &&
      advance.inferenceState != 'applied') {
    return 'avance y fotografía confirmados; inferencia del cliente pendiente';
  }
  if (advance.evidenceState == 'uploaded') {
    return 'avance confirmado; Operaciones está verificando la foto';
  }
  if (advance.evidenceState == 'authorized') {
    return 'avance confirmado; fotografía pendiente de carga';
  }
  if (advance.ownerAdvanceId != null) {
    return 'avance confirmado; evidencia pendiente';
  }
  return queueLabel(advance.state);
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.tone});

  final String text;
  final _Tone tone;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final color = switch (tone) {
      _Tone.info => scheme.surfaceContainerHighest,
      _Tone.warning => scheme.tertiaryContainer,
      _Tone.error => scheme.errorContainer,
    };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text),
    );
  }
}

enum _Tone { info, warning, error }

class _Empty extends StatelessWidget {
  const _Empty({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) =>
      Text(text, style: Theme.of(context).textTheme.bodySmall);
}

import 'dart:io';

import 'package:flutter/material.dart';

import '../offline/vehicle_history.dart';
import 'journey_controller.dart';

class VehicleHistoryPage extends StatefulWidget {
  const VehicleHistoryPage({super.key, required this.controller});
  final JourneyController controller;

  @override
  State<VehicleHistoryPage> createState() => _VehicleHistoryPageState();
}

class _VehicleHistoryPageState extends State<VehicleHistoryPage> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Historial de servicios')),
    body: AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Buscá por patente, marca o modelo.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 8),
          TextField(
            key: const Key('history-vehicle-search'),
            controller: _search,
            textInputAction: TextInputAction.search,
            decoration: const InputDecoration(
              labelText: 'Patente, marca o modelo',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) =>
                widget.controller.findHistoryVehicles(_search.text),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            key: const Key('history-vehicle-search-submit'),
            onPressed: widget.controller.busy
                ? null
                : () => widget.controller.findHistoryVehicles(_search.text),
            icon: const Icon(Icons.search),
            label: const Text('Buscar vehículos'),
          ),
          if (widget.controller.historyError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                widget.controller.historyError!,
                key: const Key('history-search-error'),
              ),
            ),
          const SizedBox(height: 12),
          ...widget.controller.historyVehicles.map(
            (vehicle) => Card(
              child: ListTile(
                key: Key('history-vehicle-${vehicle.id}'),
                title: Text(
                  '${vehicle.plate} · ${vehicle.make} ${vehicle.model}',
                ),
                subtitle: Text('${vehicle.year} · Historial del taller'),
                trailing: const Icon(Icons.chevron_right),
                onTap: widget.controller.busy
                    ? null
                    : () async {
                        final snapshot = await widget.controller
                            .loadVehicleHistory(vehicle);
                        if (!context.mounted || snapshot == null) return;
                        await Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => VehicleHistoryDetailPage(
                              controller: widget.controller,
                              initial: snapshot,
                            ),
                          ),
                        );
                      },
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

class VehicleHistoryDetailPage extends StatelessWidget {
  const VehicleHistoryDetailPage({
    super.key,
    required this.controller,
    required this.initial,
  });
  final JourneyController controller;
  final VehicleHistorySnapshot initial;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) {
      final snapshot = controller.openHistory ?? initial;
      final offline = controller.historyOffline;
      return Scaffold(
        appBar: AppBar(title: Text(snapshot.vehicle.plate)),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(
              '${snapshot.vehicle.make} ${snapshot.vehicle.model} · ${snapshot.vehicle.year}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(
              offline
                  ? 'Copia local descargada ${snapshot.fetchedAt.toLocal()}. Puede estar desactualizada.'
                  : 'Consulta online · ${snapshot.fetchedAt.toLocal()}',
              key: const Key('history-stale-state'),
            ),
            if (snapshot.truncated)
              const Padding(
                padding: EdgeInsets.only(top: 6),
                child: Text(
                  'Se muestran las 100 intervenciones más recientes; el resto no está incluido en esta copia.',
                ),
              ),
            const SizedBox(height: 8),
            FilledButton.tonalIcon(
              key: const Key('history-download-offline'),
              onPressed: !controller.snapshot.authenticated || controller.busy
                  ? null
                  : () =>
                        controller.downloadHistoryForOffline(snapshot.vehicle),
              icon: const Icon(Icons.download_for_offline_outlined),
              label: Text(
                offline
                    ? 'Actualizar copia offline'
                    : 'Descargar historial y evidencias para offline',
              ),
            ),
            if (controller.historyError != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  controller.historyError!,
                  key: const Key('history-download-error'),
                ),
              ),
            const SizedBox(height: 12),
            if (snapshot.entries.isEmpty)
              const Text('Este vehículo no tiene intervenciones completadas.'),
            ...snapshot.entries.map(
              (entry) => _HistoryEntryTile(entry: entry, offline: offline),
            ),
          ],
        ),
      );
    },
  );
}

class _HistoryEntryTile extends StatelessWidget {
  const _HistoryEntryTile({required this.entry, required this.offline});
  final VehicleServiceHistoryEntry entry;
  final bool offline;

  @override
  Widget build(BuildContext context) => Card(
    child: ExpansionTile(
      key: Key('history-order-${entry.orderId}'),
      title: Text('${entry.orderNumber} · ${entry.type}'),
      subtitle: Text(entry.servicedAt.toLocal().toString()),
      childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      children: [
        Align(alignment: Alignment.centerLeft, child: Text(entry.description)),
        if (entry.observations.isNotEmpty)
          Align(
            alignment: Alignment.centerLeft,
            child: Text('Observaciones: ${entry.observations}'),
          ),
        Align(
          alignment: Alignment.centerLeft,
          child: Text(
            'Recepción: ${entry.receptionReason}${entry.symptoms == null ? '' : ' · Síntomas: ${entry.symptoms}'}',
          ),
        ),
        for (final service in entry.services)
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '${service.recordedName} · ${service.quantity} × ${service.minutes} min',
            ),
          ),
        for (final evidence in entry.evidences) ...[
          const Divider(),
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              '${evidence.fileName} · ${evidence.contentType} · ${evidence.sizeBytes} bytes',
            ),
          ),
          if (offline &&
              evidence.localPath != null &&
              evidence.contentType.startsWith('image/'))
            ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 220),
              child: Image.file(File(evidence.localPath!), fit: BoxFit.contain),
            )
          else if (offline)
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Evidencia descargada en el almacenamiento privado de la app.',
              ),
            )
          else
            const Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'La evidencia se incluirá al descargar la copia offline.',
              ),
            ),
        ],
      ],
    ),
  );
}

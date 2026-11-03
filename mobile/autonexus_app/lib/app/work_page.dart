/// Detail of a prepared work: consult it without network and save an advance in the queue.
///
/// Saving here never claims the server accepted anything. The sentence changes with the session
/// state, because "guardado" in this screen means "guardado en este dispositivo".
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../offline/offline_models.dart';
import 'journey_controller.dart';
import 'journey_home.dart' show queueLabel;

class WorkPage extends StatefulWidget {
  const WorkPage({super.key, required this.controller, required this.work});

  final JourneyController controller;
  final PreparedWork work;

  @override
  State<WorkPage> createState() => _WorkPageState();
}

class _WorkPageState extends State<WorkPage> {
  final TextEditingController _description = TextEditingController(text: 'Avance registrado sin conexión');
  final TextEditingController _minutes = TextEditingController(text: '15');
  String? _result;
  bool _saving = false;

  @override
  void dispose() {
    _description.dispose();
    _minutes.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final description = _description.text.trim();
    final minutes = int.tryParse(_minutes.text.trim());
    if (description.length < 3) {
      setState(() => _result = 'La descripción necesita al menos 3 caracteres.');
      return;
    }
    if (minutes == null || minutes < 1 || minutes > 1440) {
      setState(() => _result = 'Los minutos deben estar entre 1 y 1440.');
      return;
    }
    setState(() => _saving = true);
    final created = await widget.controller.queueAdvance(work: widget.work, description: description, minutes: minutes);
    if (!mounted) return;
    setState(() {
      _saving = false;
      _result = created == null
          ? 'No se pudo guardar: ${widget.controller.lastError ?? 'error desconocido'}'
          : 'Guardado en este dispositivo como pendiente. Todavía no está en el servidor.';
    });
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: widget.controller,
      builder: (context, _) {
        final work = widget.work;
        final usable = work.isUsableAt(DateTime.now().toUtc());
        final mine = widget.controller.queue.where((item) => item.assignmentId == work.assignmentId).toList();
        final authenticated = widget.controller.snapshot.authenticated;
        return Scaffold(
          appBar: AppBar(title: Text(work.orderNumber)),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Trabajo preparado', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 4),
                      Text('Versión ${work.version} · orden ${work.orderId}'),
                      Text('Preparado el ${work.preparedAt.toLocal()}'),
                      const SizedBox(height: 4),
                      Text(
                        usable
                            ? 'La copia local es utilizable hasta ${work.expiresAt.toLocal()}.'
                            : 'La preparación venció. Se puede consultar, pero hay que revalidar con conexión antes de sincronizar.',
                        style: TextStyle(color: usable ? null : Theme.of(context).colorScheme.error),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('advance-description'),
                controller: _description,
                decoration: const InputDecoration(labelText: 'Descripción del avance', border: OutlineInputBorder()),
                maxLines: 3,
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('advance-minutes'),
                controller: _minutes,
                decoration: const InputDecoration(labelText: 'Minutos trabajados', border: OutlineInputBorder()),
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('save-advance'),
                onPressed: _saving ? null : _save,
                icon: const Icon(Icons.save_outlined),
                label: const Text('Guardar avance pendiente'),
              ),
              const SizedBox(height: 8),
              Text(
                authenticated
                    ? 'Con sesión vigente podés sincronizar cuando vuelva la conexión.'
                    : 'Sin sesión podés seguir trabajando sobre la copia preparada; sincronizar exigirá volver a iniciar sesión.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (_result != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: Theme.of(context).colorScheme.surfaceContainerHighest, borderRadius: BorderRadius.circular(8)),
                  child: Text(_result!),
                ),
              ],
              const SizedBox(height: 16),
              Text('Avances guardados en este trabajo', style: Theme.of(context).textTheme.titleMedium),
              if (mine.isEmpty)
                const Text('Ninguno todavía.')
              else
                ...mine.map((advance) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(advance.description, maxLines: 2, overflow: TextOverflow.ellipsis),
                      subtitle: Text(
                        '${advance.minutesWorked} min · ${queueLabel(advance.state)}'
                        '${advance.lastCode == null ? '' : ' · ${advance.lastCode}'}',
                      ),
                    )),
            ],
          ),
        );
      },
    );
  }
}

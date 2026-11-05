/// Detail of a prepared work: consult it without network and save an advance in the queue.
///
/// Saving here never claims the server accepted anything. The sentence changes with the session
/// state, because "guardado" in this screen means "guardado en este dispositivo".
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../offline/offline_models.dart';
import '../inference/damage_classifier.dart';
import '../evidence/photo_capture.dart';
import 'journey_controller.dart';
import 'journey_home.dart' show queueProgressLabel;

class WorkPage extends StatefulWidget {
  const WorkPage({super.key, required this.controller, required this.work});

  final JourneyController controller;
  final PreparedWork work;

  @override
  State<WorkPage> createState() => _WorkPageState();
}

class _WorkPageState extends State<WorkPage> {
  final TextEditingController _description = TextEditingController(
    text: 'Avance registrado sin conexión',
  );
  final TextEditingController _minutes = TextEditingController(text: '15');
  String? _result;
  bool _saving = false;
  bool _saved = false;
  bool _photoBusy = false;
  bool _humanReviewed = false;
  final Set<String> _humanLabels = {};
  StagedPhoto? _photo;
  Uint8List? _photoBytes;
  DamageClassifier? _classifier;
  DeviceResult? _analysis;
  String? _photoError;

  @override
  void initState() {
    super.initState();
    unawaited(_restorePhoto());
  }

  @override
  void dispose() {
    _description.dispose();
    _minutes.dispose();
    _classifier?.dispose();
    super.dispose();
  }

  Future<void> _restorePhoto() async {
    try {
      final photo = await widget.controller.stagedPhoto(widget.work);
      if (photo == null) return;
      final bytes = await File(photo.path).readAsBytes();
      await _analysePhoto(photo, bytes);
    } catch (_) {
      if (mounted)
        setState(
          () => _photoError = 'No se pudo recuperar la fotografía local. Podés volver a elegirla.',
        );
    }
  }

  Future<void> _choosePhoto(PhotoSource source) async {
    setState(() {
      _photoBusy = true;
      _photoError = null;
    });
    try {
      final photo = await widget.controller.capturePhoto(widget.work, source);
      if (photo == null || !mounted) return;
      final bytes = await File(photo.path).readAsBytes();
      await _analysePhoto(photo, bytes);
    } catch (_) {
      if (mounted)
        setState(
          () => _photoError = 'No se pudo preparar esa fotografía. Elegí otra imagen JPEG o PNG.',
        );
    } finally {
      if (mounted) setState(() => _photoBusy = false);
    }
  }

  Future<void> _analysePhoto(StagedPhoto photo, Uint8List bytes) async {
    if (mounted)
      setState(() {
        _photo = photo;
        _photoBytes = bytes;
        _analysis = null;
      });
    try {
      final classifier = _classifier ?? await DamageClassifier.load();
      if (!mounted) {
        if (_classifier == null) classifier.dispose();
        return;
      }
      _classifier = classifier;
      final analysis = await classifier.analyse(bytes);
      if (!mounted) return;
      setState(() {
        _analysis = analysis;
        _humanReviewed = false;
        _humanLabels
          ..clear()
          ..addAll(
            analysis.scores
                .where((score) => score.flagged)
                .map((score) => score.label),
          );
        _photoError = null;
      });
    } catch (_) {
      if (mounted)
        setState(
          () => _photoError = 'La foto quedó guardada localmente, pero no se pudo ejecutar el modelo.',
        );
    }
  }

  Future<void> _removePhoto() async {
    await widget.controller.removeStagedPhoto(widget.work);
    if (!mounted) return;
    setState(() {
      _photo = null;
      _photoBytes = null;
      _analysis = null;
      _humanReviewed = false;
      _humanLabels.clear();
      _photoError = null;
    });
  }

  Future<void> _save() async {
    final description = _description.text.trim();
    final minutes = int.tryParse(_minutes.text.trim());
    if (description.length < 3) {
      setState(
        () => _result = 'La descripción necesita al menos 3 caracteres.',
      );
      return;
    }
    if (minutes == null || minutes < 1 || minutes > 1440) {
      setState(() => _result = 'Los minutos deben estar entre 1 y 1440.');
      return;
    }
    setState(() => _saving = true);
    final created = await widget.controller.queueAdvance(
      work: widget.work,
      description: description,
      minutes: minutes,
      photo: _photo,
      runId: _analysis == null ? null : _classifier?.manifest.runId,
      modelVersion: _analysis == null
          ? null
          : _classifier?.manifest.modelVersion,
      labels: {
        for (final score in _analysis?.scores ?? const <DeviceScore>[])
          score.label: score.score,
      },
      humanReviewLabels: _humanReviewed
          ? (_humanLabels.toList()..sort())
          : null,
      humanReviewedAt: _humanReviewed ? DateTime.now().toUtc() : null,
    );
    if (!mounted) return;
    setState(() {
      _saving = false;
      _saved = created != null;
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
        final mine = widget.controller.queue
            .where((item) => item.assignmentId == work.assignmentId)
            .toList();
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
                      Text(
                        'Trabajo preparado',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 4),
                      Text('Versión ${work.version} · orden ${work.orderId}'),
                      Text('Preparado el ${work.preparedAt.toLocal()}'),
                      const SizedBox(height: 4),
                      Text(
                        usable
                            ? 'La copia local es utilizable hasta ${work.expiresAt.toLocal()}.'
                            : 'La preparación venció. Se puede consultar, pero hay que revalidar con conexión antes de sincronizar.',
                        style: TextStyle(
                          color: usable
                              ? null
                              : Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('advance-description'),
                controller: _description,
                decoration: const InputDecoration(
                  labelText: 'Descripción del avance',
                  border: OutlineInputBorder(),
                ),
                maxLines: 3,
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('advance-minutes'),
                controller: _minutes,
                decoration: const InputDecoration(
                  labelText: 'Minutos trabajados',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.number,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              ),
              const SizedBox(height: 12),
              Text(
                'Evidencia fotográfica',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 6),
              Text(
                'La imagen se conserva en el almacenamiento privado del dispositivo.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    key: const Key('capture-photo'),
                    onPressed: _photoBusy || _saving
                        ? null
                        : () => _choosePhoto(PhotoSource.camera),
                    icon: const Icon(Icons.photo_camera_outlined),
                    label: const Text('Tomar foto'),
                  ),
                  OutlinedButton.icon(
                    key: const Key('choose-photo'),
                    onPressed: _photoBusy || _saving
                        ? null
                        : () => _choosePhoto(PhotoSource.gallery),
                    icon: const Icon(Icons.photo_library_outlined),
                    label: const Text('Elegir imagen'),
                  ),
                ],
              ),
              if (_photoBusy) ...[
                const SizedBox(height: 8),
                const LinearProgressIndicator(),
                const SizedBox(height: 8),
                const Text(
                  'Preparando la imagen y ejecutando el modelo en este dispositivo.',
                ),
              ],
              if (_photoBytes != null && _photo != null) ...[
                const SizedBox(height: 10),
                Semantics(
                  label: 'Fotografía de evidencia guardada localmente',
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.memory(
                      _photoBytes!,
                      height: 220,
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const SizedBox(
                        height: 120,
                        child: Center(
                          child: Text('No se pudo mostrar la imagen.'),
                        ),
                      ),
                    ),
                  ),
                ),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'JPEG · ${(_photo!.bytes / 1024).toStringAsFixed(0)} KiB',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ),
                    TextButton.icon(
                      onPressed: _photoBusy || _saving ? null : _removePhoto,
                      icon: const Icon(Icons.delete_outline),
                      label: const Text('Quitar'),
                    ),
                  ],
                ),
                if (_analysis != null && _classifier != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: Theme.of(context).colorScheme.tertiaryContainer,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Capacidad visual ${_classifier!.manifest.qualityStatus == 'validated' ? 'validada' : 'NO validada'} · ${_classifier!.manifest.runId}',
                          style: Theme.of(context).textTheme.titleSmall,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Señal experimental para revisión humana; no es un diagnóstico.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 8),
                        ..._analysis!.scores.map(
                          (score) => Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Row(
                              children: [
                                SizedBox(
                                  width: 112,
                                  child: Text(_labelName(score.label)),
                                ),
                                Expanded(
                                  child: LinearProgressIndicator(
                                    value: score.score.clamp(0.0, 1.0),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                SizedBox(
                                  width: 46,
                                  child: Text(
                                    '${(score.score * 100).toStringAsFixed(1)}%',
                                    textAlign: TextAlign.end,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          value: _humanReviewed,
                          onChanged: _saving
                              ? null
                              : (value) =>
                                    setState(() => _humanReviewed = value),
                          title: const Text('Registrar mi revisión'),
                          subtitle: Text(
                            'Se guarda aparte de la predicción · ${_classifier!.manifest.modelVersion}',
                          ),
                        ),
                        if (_humanReviewed)
                          Wrap(
                            spacing: 8,
                            runSpacing: 4,
                            children: [
                              for (final score in _analysis!.scores)
                                FilterChip(
                                  label: Text(_labelName(score.label)),
                                  selected: _humanLabels.contains(score.label),
                                  onSelected: _saving
                                      ? null
                                      : (selected) => setState(() {
                                          if (selected) {
                                            _humanLabels.add(score.label);
                                          } else {
                                            _humanLabels.remove(score.label);
                                          }
                                        }),
                                ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ],
              ],
              if (_photoError != null) ...[
                const SizedBox(height: 8),
                Text(
                  _photoError!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ],
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const Key('save-advance'),
                onPressed: _saving || _photoBusy || _saved ? null : _save,
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
                  decoration: BoxDecoration(
                    color: Theme.of(context)
                        .colorScheme
                        .surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(_result!),
                ),
              ],
              const SizedBox(height: 16),
              Text(
                'Avances guardados en este trabajo',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              if (mine.isEmpty)
                const Text('Ninguno todavía.')
              else
                ...mine.map(
                  (advance) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      advance.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      '${advance.minutesWorked} min · ${queueProgressLabel(advance)}'
                      '${advance.lastCode == null ? '' : ' · ${advance.lastCode}'}',
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

String _labelName(String label) => switch (label) {
  'crack' => 'Grieta',
  'dent' => 'Abolladura',
  'glass_shatter' => 'Vidrio roto',
  'scratch' => 'Raspón',
  _ => label,
};

/// Detail of a prepared work: consult it without network and save an advance in the queue.
///
/// Saving here never claims the server accepted anything. The sentence changes with the session
/// state, because "guardado" in this screen means "guardado en este dispositivo".
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../offline/offline_models.dart';
import '../inference/damage_classifier.dart';
import '../evidence/photo_capture.dart';
import 'journey_controller.dart';
import 'journey_home.dart' show queueProgressLabel;

class WorkPage extends StatefulWidget {
  const WorkPage({
    super.key,
    required this.controller,
    required this.work,
    this.loadClassifier = DamageClassifier.load,
  });

  final JourneyController controller;
  final PreparedWork work;
  final Future<InspectionClassifier> Function() loadClassifier;

  @override
  State<WorkPage> createState() => _WorkPageState();
}

class _WorkPageState extends State<WorkPage> {
  final TextEditingController _description = TextEditingController();
  final TextEditingController _minutes = TextEditingController();
  final FocusNode _descriptionFocus = FocusNode();
  final FocusNode _minutesFocus = FocusNode();
  String? _descriptionError;
  String? _minutesError;
  String? _result;
  bool _saving = false;
  bool _saved = false;
  bool _photoBusy = false;
  bool _humanReviewed = false;
  final Set<String> _humanLabels = {};
  StagedPhoto? _photo;
  Uint8List? _photoBytes;
  InspectionClassifier? _classifier;
  bool _manual = true;
  String _reason = 'operator_manual';
  DeviceResult? _analysis;
  String? _photoError;

  @override
  void initState() {
    super.initState();
    final draft = widget.controller.advanceDraft(widget.work);
    if (draft != null) {
      _description.text = draft.description;
      _minutes.text = draft.minutes;
    }
    unawaited(_restorePhoto());
  }

  @override
  void dispose() {
    _description.dispose();
    _minutes.dispose();
    _descriptionFocus.dispose();
    _minutesFocus.dispose();
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
      if (mounted) {
        setState(
          () => _photoError =
              'No se pudo recuperar la fotografía local. Podés volver a elegirla.',
        );
      }
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
    } catch (error) {
      if (mounted) {
        setState(() {
          if (_photo == null && !_humanReviewed) {
            _reason = error is OutOfMemoryError
                ? 'insufficient_resources'
                : error is PhotoInputException
                ? error.reason
                : 'input_rejected';
          }
          _photoError =
              'No se pudo preparar la foto: $error. Podés retomar o registrar manualmente.';
        });
      }
    } finally {
      if (mounted) setState(() => _photoBusy = false);
    }
  }

  Future<void> _analysePhoto(StagedPhoto photo, Uint8List bytes) async {
    if (mounted) {
      setState(() {
        _photo = photo;
        _photoBytes = bytes;
        _analysis = null;
        _humanReviewed = false;
        _humanLabels.clear();
        _manual = true;
        _reason = 'operator_manual';
      });
    }
    try {
      final classifier = _classifier ?? await widget.loadClassifier();
      if (!mounted) {
        if (_classifier == null) classifier.dispose();
        return;
      }
      _classifier = classifier;
      final analysis = await classifier.analyse(bytes);
      if (!mounted) return;
      setState(() {
        _analysis = analysis;
        _reason = analysis.inconclusive
            ? 'below_thresholds'
            : 'operator_manual';
        _photoError = null;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _manual = true;
          _reason = error is OutOfMemoryError
              ? 'insufficient_resources'
              : _classifier == null
              ? 'model_unavailable'
              : 'inference_failed';
          _photoError = _reason == 'model_unavailable'
              ? 'Modelo no disponible o manifiesto inválido. La foto sigue local; registrá manualmente.'
              : _reason == 'insufficient_resources'
              ? 'Recursos insuficientes. La foto sigue local; registrá manualmente o reintentá.'
              : 'Falló la inferencia. La foto sigue local; registrá manualmente o reintentá.';
        });
      }
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
    setState(() {
      _descriptionError =
          description.length < 3 ||
              description.length > (_humanReviewed ? 1600 : 2000)
          ? 'La descripción necesita entre 3 y ${_humanReviewed ? 1600 : 2000} caracteres.'
          : null;
      _minutesError = minutes == null || minutes < 1 || minutes > 1440
          ? 'Los minutos deben estar entre 1 y 1440.'
          : null;
    });
    if (_descriptionError != null || _minutesError != null) {
      final focus = _descriptionError != null
          ? _descriptionFocus
          : _minutesFocus;
      focus.requestFocus();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && focus.context != null) {
          Scrollable.ensureVisible(focus.context!, alignment: 0.2);
        }
      });
      return;
    }
    setState(() {
      _saving = true;
      _result = null;
    });
    final created = await widget.controller.queueAdvance(
      work: widget.work,
      description: description,
      minutes: minutes!,
      photo: _photo,
      inspectionReview: _humanReviewed
          ? InspectionReview(
              mode: _manual || _analysis == null ? 'manual' : 'assisted',
              reason: _reason,
              interpretation: description,
              labels: _humanLabels.toList()..sort(),
              reviewedAt: DateTime.now().toUtc(),
            )
          : null,
      runId: _analysis == null ? null : _classifier?.manifest.runId,
      modelVersion: _analysis == null
          ? null
          : _classifier?.manifest.modelVersion,
      labels: {
        for (final score in _analysis?.scores ?? const <DeviceScore>[])
          score.label: score.score,
      },
      humanReviewLabels: _humanReviewed && _analysis != null
          ? (_humanLabels.toList()..sort())
          : null,
      humanReviewedAt: _humanReviewed && _analysis != null
          ? DateTime.now().toUtc()
          : null,
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

  void _saveDraft() => widget.controller.saveAdvanceDraft(
    widget.work,
    description: _description.text,
    minutes: _minutes.text,
  );

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
          body: SafeArea(
            child: ListView(
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
                  focusNode: _descriptionFocus,
                  onChanged: (_) => _saveDraft(),
                  decoration: InputDecoration(
                    errorText: _descriptionError,
                    // Dos líneas: con el contador de maxLength el mensaje se cortaba en «carac…».
                    errorMaxLines: 2,
                    labelText: 'Descripción del avance',
                    border: OutlineInputBorder(),
                  ),
                  maxLines: 3,
                  maxLength: _humanReviewed ? 1600 : 2000,
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('advance-minutes'),
                  controller: _minutes,
                  focusNode: _minutesFocus,
                  onChanged: (_) => _saveDraft(),
                  decoration: InputDecoration(
                    errorText: _minutesError,
                    errorMaxLines: 2,
                    labelText: 'Minutos trabajados',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _minutesFocus.unfocus(),
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
                        errorBuilder: (_, _, _) => const SizedBox(
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
                          if (_analysis!.inconclusive)
                            const Text(
                              'No concluyente: ninguna etiqueta alcanza su umbral experimental; no descarta daño. Se requiere interpretación humana.',
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
                        ],
                      ),
                    ),
                  ],
                ],
                SwitchListTile(
                  key: const Key('inspection-review'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Registrar mi revisión de inspección'),
                  subtitle: const Text(
                    'Registro manual disponible sin modelo. Usa la descripción del avance; se guarda aparte de los puntajes.',
                  ),
                  value: _humanReviewed,
                  onChanged: _saving || _saved
                      ? null
                      : (value) => setState(() => _humanReviewed = value),
                ),
                if (_humanReviewed) ...[
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Usar registro manual'),
                    value: _manual || _analysis == null,
                    onChanged: _saving || _saved || _analysis == null
                        ? null
                        : (value) => setState(() => _manual = value),
                  ),
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    key: ValueKey('inspection-reason-$_reason'),
                    initialValue: _reason,
                    decoration: const InputDecoration(
                      labelText: 'Motivo de la revisión',
                    ),
                    items: InspectionReview.reasons
                        .map(
                          (reason) => DropdownMenuItem(
                            value: reason,
                            child: Text(_reasonName(reason)),
                          ),
                        )
                        .toList(),
                    onChanged: _saving || _saved
                        ? null
                        : (value) => setState(() => _reason = value!),
                  ),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final label in InspectionReview.labelCodes)
                        FilterChip(
                          label: Text(_labelName(label)),
                          selected: _humanLabels.contains(label),
                          onSelected: _saving || _saved
                              ? null
                              : (selected) => setState(() {
                                  if (selected) {
                                    _humanLabels.add(label);
                                  } else {
                                    _humanLabels.remove(label);
                                  }
                                }),
                        ),
                    ],
                  ),
                ],
                if (_photoError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _photoError!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
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
                      color: Theme.of(
                        context,
                      ).colorScheme.surfaceContainerHighest,
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

String _reasonName(String reason) => switch (reason) {
  'operator_manual' => 'Decisión del operador',
  'model_unavailable' => 'Modelo no disponible',
  'inference_failed' => 'Inferencia fallida',
  'insufficient_resources' => 'Recursos insuficientes',
  'below_thresholds' => 'Puntajes bajo los umbrales',
  'input_rejected' => 'Imagen rechazada',
  _ => reason,
};

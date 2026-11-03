import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;

import 'damage_classifier.dart';

/// CU22 — the on-device screen. It shows the experimental notice next to the run identifier before
/// any score, because a result that looks authoritative without that context is worse than no result.
class InspectionPage extends StatefulWidget {
  const InspectionPage({super.key});

  @override
  State<InspectionPage> createState() => _InspectionPageState();
}

class _InspectionPageState extends State<InspectionPage> {
  DamageClassifier? _classifier;
  String? _error;
  DeviceResult? _result;
  String _imageName = 'sin imagen';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final classifier = await DamageClassifier.load();
      if (!mounted) {
        classifier.dispose();
        return;
      }
      setState(() => _classifier = classifier);
    } catch (error) {
      setState(() => _error = 'No se pudo cargar el modelo: $error');
    }
  }

  Future<void> _analyseFixture() async {
    final classifier = _classifier;
    if (classifier == null) return;
    try {
      // The bundled sample is the same photograph used by the server verification, so the numbers on
      // the device can be compared with the Python reference for the same bytes.
      final data = await rootBundle.load('assets/samples/sample.jpg');
      final bytes = Uint8List.view(data.buffer);
      final result = classifier.runTensor(classifier.preprocess(bytes));
      setState(() {
        _result = result;
        _imageName = 'sample.jpg';
      });
    } catch (error) {
      setState(() => _error = 'Fallo en la inferencia: $error');
    }
  }

  @override
  void dispose() {
    _classifier?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final classifier = _classifier;
    final manifest = classifier?.manifest;
    return Scaffold(
      appBar: AppBar(title: const Text('Inteligencia visual')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: Theme.of(context).colorScheme.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    manifest == null
                        ? 'Capacidad visual NO validada'
                        : 'Capacidad visual ${manifest.qualityStatus == 'validated' ? 'validada' : 'NO validada'} · corrida ${manifest.runId}',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 6),
                  Text(manifest?.qualityNote ?? DamageClassifier.experimentalNotice),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null) Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          if (manifest != null)
            Text('Etiquetas del modelo: ${manifest.labels.join(', ')}', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: classifier == null ? null : _analyseFixture,
            child: const Text('Analizar imagen de muestra'),
          ),
          const SizedBox(height: 16),
          if (_result != null) ...[
            Text('Imagen: $_imageName · inferencia ${_result!.latencyMs.toStringAsFixed(1)} ms'),
            const SizedBox(height: 8),
            ..._result!.scores.map((score) => ListTile(
                  dense: true,
                  title: Text(score.label),
                  subtitle: LinearProgressIndicator(value: score.score.clamp(0.0, 1.0)),
                  trailing: Text('${(score.score * 100).toStringAsFixed(1)}%'),
                )),
            const SizedBox(height: 12),
            const Text('Señal para revisión humana: no es un diagnóstico ni una medición.'),
          ],
        ],
      ),
    );
  }
}

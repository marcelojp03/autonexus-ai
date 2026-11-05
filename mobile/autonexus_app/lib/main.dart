import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:url_launcher/url_launcher.dart';

import 'api/owner_api.dart';
import 'app/journey_controller.dart';
import 'app/journey_home.dart';
import 'config.dart';
import 'evidence/photo_capture.dart';
import 'offline/offline_store.dart';
import 'offline/sync_service.dart';
import 'session/keycloak_session.dart';

/// Mobile entry point.
///
/// The app opens on the offline journey: the prepared copy is readable without network, and the
/// session is what authorises downloading work and syncing the queue. The CU22 on-device screen stays
/// reachable from the app bar.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // `.env` is a Flutter asset, not a process environment file. It contains only public endpoints
  // and client metadata; never put a client secret, bearer, refresh token or storage credential here.
  await dotenv.load(fileName: 'assets/config/.env', isOptional: true);
  final store = await OfflineStore.open();
  final photoCapture = MobilePhotoCapture();
  await _recoverLostPhoto(photoCapture, store);
  final session = KeycloakSession(
    issuer: AppConfig.issuer,
    clientId: AppConfig.clientId,
    redirectUrl: AppConfig.redirectUrl,
    store: store,
    launchBrowser: (url) =>
        launchUrl(url, mode: LaunchMode.externalApplication),
  );
  final ownerApi = OwnerApi(baseUrl: AppConfig.ownerUrl);
  final sync = SyncService(
    baseUrl: AppConfig.syncUrl,
    store: store,
    readExecutionVersion: (token, assignmentId) async =>
        (await ownerApi.execution(token, assignmentId)).version,
  );
  final controller = JourneyController(
    session: session,
    store: store,
    api: ownerApi,
    sync: sync,
    photoCapture: photoCapture,
  );
  await controller.load();
  runApp(AutoNexusMobileApp(controller: controller));
}

Future<void> _recoverLostPhoto(
  PhotoCapturePort photoCapture,
  OfflineStore store,
) async {
  final context = await store.pendingPhotoCapture();
  try {
    final lost = await photoCapture.retrieveLostPhoto();
    if (context == null || lost == null) return;
    final prepared = PhotoProcessor.prepare(lost);
    await store.saveStagedPhoto(
      subject: context.subject,
      assignmentId: context.assignmentId,
      bytes: prepared.bytes,
      sha256: prepared.sha256,
    );
  } catch (_) {
    // The page will stay usable; the operator can select the image again if recovery failed.
  } finally {
    if (context != null) await store.clearPendingPhotoCapture(context.subject);
  }
}

class AutoNexusMobileApp extends StatefulWidget {
  const AutoNexusMobileApp({super.key, required this.controller});

  final JourneyController controller;

  @override
  State<AutoNexusMobileApp> createState() => _AutoNexusMobileAppState();
}

class _AutoNexusMobileAppState extends State<AutoNexusMobileApp> {
  late final AppLinks _links;
  StreamSubscription<Uri>? _subscription;

  @override
  void initState() {
    super.initState();
    _links = AppLinks();
    // The redirect arrives as a deep link. Listening here (not inside the sign-in call) is what makes
    // the flow survive a process restart while the browser is in the foreground.
    _subscription = _links.uriLinkStream.listen(
      widget.controller.handleCallback,
      onError: (Object _) {},
    );
    _links
        .getInitialLink()
        .then((uri) {
          if (uri != null) unawaited(widget.controller.handleCallback(uri));
        })
        .catchError((Object _) {});
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'AutoNexus · Taller',
    theme: ThemeData(
      colorSchemeSeed: const Color(0xFF1677FF),
      useMaterial3: true,
    ),
    home: JourneyHome(controller: widget.controller),
  );
}

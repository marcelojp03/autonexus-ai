import 'dart:convert';

import 'package:autonexus_mobile/api/owner_api.dart';
import 'package:autonexus_mobile/offline/vehicle_history.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test(
    'evidence is assignment scoped and uses its own version and state',
    () async {
      final api = OwnerApi(
        baseUrl: 'http://owner',
        client: MockClient((request) async {
          expect(request.url.path, '/executions/me/assignment-1');
          expect(request.headers['authorization'], 'Bearer actor');
          return http.Response(
            jsonEncode({
              'assignmentId': 'assignment-1',
              'orderId': 'order-1',
              'orderNumber': 'OT-1',
              'version': 40,
              'advances': [
                {
                  'id': 'advance-1',
                  'evidences': [
                    {'id': 'evidence-1', 'version': 2, 'state': 'failed'},
                  ],
                },
                {
                  'id': 'advance-2',
                  'evidences': [
                    {'id': 'evidence-2', 'version': 9, 'state': 'available'},
                  ],
                },
              ],
            }),
            200,
          );
        }),
      );
      final evidence = await api.evidence(
        'actor',
        'assignment-1',
        'evidence-1',
      );
      expect(evidence.version, 2);
      expect(evidence.state, 'failed');
      expect(evidence.id, 'evidence-1');
      await expectLater(
        api.evidence('actor', 'assignment-1', 'missing'),
        throwsA(
          isA<OwnerFailure>().having(
            (e) => e.code,
            'code',
            'EVIDENCE_NOT_FOUND',
          ),
        ),
      );
      api.dispose();
    },
  );

  test('evidence read preserves owner access rejection', () async {
    final api = OwnerApi(
      baseUrl: 'http://owner',
      client: MockClient(
        (request) async =>
            http.Response('{"code":"EXECUTION_ACCESS_DENIED"}', 403),
      ),
    );
    await expectLater(
      api.evidence('actor', 'other-assignment', 'evidence-1'),
      throwsA(isA<OwnerFailure>().having((e) => e.status, 'status', 403)),
    );
    api.dispose();
  });

  test(
    'CU08 vehicle picker, history and private evidence use the employee bearer and no-store bytes',
    () async {
      final calls = <http.Request>[];
      final api = OwnerApi(
        baseUrl: 'http://owner',
        client: MockClient((request) async {
          calls.add(request);
          expect(request.headers['authorization'], 'Bearer mechanic-token');
          if (request.url.path == '/vehicles/service-history/vehicles') {
            expect(request.url.queryParameters['search'], 'ABC');
            return http.Response(
              jsonEncode({
                'items': [
                  {
                    'id': 'vehicle-1',
                    'plate': 'ABC-123',
                    'make': 'Toyota',
                    'model': 'Yaris',
                    'year': 2022,
                  },
                ],
                'total': 1,
                'limit': 100,
                'offset': 0,
              }),
              200,
            );
          }
          if (request.url.path == '/vehicles/vehicle-1/service-history') {
            return http.Response(
              jsonEncode({
                'items': [
                  {
                    'orderId': 'order-1',
                    'orderNumber': 'WO-1',
                    'servicedAt': '2026-11-08T12:00:00Z',
                    'type': 'mantenimiento',
                    'status': 'completed',
                    'description': 'Servicio',
                    'observations': '',
                    'receptionReason': 'Rutina',
                    'symptoms': null,
                    'services': [],
                    'evidences': [
                      {
                        'id': 'evidence-1',
                        'fileName': 'photo.png',
                        'contentType': 'image/png',
                        'sizeBytes': 3,
                        'createdAt': '2026-11-08T12:00:00Z',
                      },
                    ],
                  },
                ],
                'total': 1,
                'limit': 100,
                'offset': 0,
              }),
              200,
            );
          }
          expect(
            request.url.path,
            '/vehicles/vehicle-1/service-history/order-1/evidence/evidence-1',
          );
          expect(request.headers['cache-control'], 'no-store');
          return http.Response.bytes(
            [1, 2, 3],
            200,
            headers: {
              'content-type': 'image/png',
              'content-length': '3',
              'cache-control': 'private, no-store',
            },
          );
        }),
      );

      final vehicle = (await api.findHistoryVehicles(
        'mechanic-token',
        'ABC',
      )).single;
      expect(vehicle.plate, 'ABC-123');
      final history = await api.vehicleServiceHistory(
        'mechanic-token',
        vehicle.id,
      );
      expect(history.entries.single.status, 'completed');
      expect(history.truncated, isFalse);
      final evidence = history.entries.single.evidences.single;
      final file = await api.downloadHistoryEvidence(
        'mechanic-token',
        vehicle.id,
        'order-1',
        evidence,
      );
      expect(file.bytes, [1, 2, 3]);
      expect(file.contentType, 'image/png');
      expect(calls, hasLength(3));
      api.dispose();
    },
  );

  test(
    'CU08 picker rejects unbounded search and preserves forbidden owner responses',
    () async {
      final api = OwnerApi(
        baseUrl: 'http://owner',
        client: MockClient(
          (request) async => http.Response('{"code":"FORBIDDEN"}', 403),
        ),
      );
      await expectLater(
        api.findHistoryVehicles('token', 'A'),
        throwsA(isA<FormatException>()),
      );
      await expectLater(
        api.findHistoryVehicles('token', 'AB'),
        throwsA(
          isA<OwnerFailure>().having(
            (failure) => failure.status,
            'status',
            403,
          ),
        ),
      );
      api.dispose();
    },
  );
}

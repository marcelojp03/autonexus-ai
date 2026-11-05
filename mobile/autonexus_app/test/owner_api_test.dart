import 'dart:convert';

import 'package:autonexus_mobile/api/owner_api.dart';
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
}

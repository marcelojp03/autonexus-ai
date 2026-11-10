# Employee push installations (Android first slice)

Base URL: Employees. Every operation requires the ordinary authenticated bearer token. The server
uses its verified `sub` to resolve the active mechanic; a body-supplied employee ID or subject is
ignored/rejected. Responses never contain an installation identifier.

## Register or rotate

`POST /push/installations`

```json
{"fid":"<Firebase Installation ID>","platform":"android","appId":"bo.edu.uagrm.autonexus.autonexus_mobile"}
```

Returns `200 {"registered":true}`. Re-registering one FID updates its owning employee/subject and
reactivates it, so account changes cannot leave an installation bound to two users.

## Remove current account association

`DELETE /push/installations` with `{"fid":"<Firebase Installation ID>"}` returns
`200 {"removed":true}`. A mismatched subject has no effect. Mobile logout attempts this before
clearing its in-memory credentials, but still completes logout if the network is unavailable.

## Delivery

Employees persists a committed CU15 `order.confirmed` Inbox notification, then a separate worker
claims it and sends through Firebase Admin. Delivery uses FID, generic notification copy and only
`eventKind` plus opaque `assignmentId`. No credential means notification delivery is disabled; it
does not block service startup or roll back CU15. Configure
`GOOGLE_APPLICATION_CREDENTIALS` to a developer-local read-only mounted service-account JSON file,
or use ADC supplied by the runtime. Never copy that credential into the repository, image, or client.
Invalid/unregistered FIDs are deactivated; transient failures retry a bounded number of times.

The app treats the payload as a navigation hint and reloads the authenticated mechanic agenda before
opening any work. FCM delivery itself requires a real Firebase project and Android device.

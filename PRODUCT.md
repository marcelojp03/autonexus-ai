# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Workshop employees use the platform to serve customers and run one automotive workshop. Confirmed roles are administrator, receptionist, mechanic, workshop manager, and finance staff. Customers need no account initially; external MCP clients are a separate audience with separately controlled access.

## Product Purpose

AutoNexus supports the workshop journey from customer and vehicle records through appointment, reception, work order, service decision, execution, verification, payment, and delivery. Success means staff can coordinate that journey and maintain its operational and financial records; the documented journey is a target, not evidence that every capability is complete.

## Positioning

The product is scoped to operating a single automotive workshop and its services. It does not manage branches or multi-company operations, inventory or spare parts, or product sales.

## Operating Context

Staff use web microfrontends in a Shell/PWA and an Android Flutter application. The intended workflow covers customer/vehicle intake, appointments and work orders, quotations and customer decisions, service scheduling and mechanic assignment, execution evidence, verification, payment, and vehicle delivery. Keycloak provides the agreed SSO direction. n8n automation and an external MCP server are separate integrations; the external MCP is independent of internal agents.

## Capabilities and Constraints

- The agreed architecture comprises five backend microservices, a NestJS BFF, four web microfrontends, a Shell/PWA, and Android mobile. The service domains are Operations, Employees, Finance, Intelligence, and Synchronization.
- Web management uses GraphQL; mobile and internal integration use REST. MCP uses its own protocol and adapts to authorized APIs.
- Each service owns its data store and business rules. Agreed stores include PostgreSQL, MongoDB, and DynamoDB. RabbitMQ/Outbox and a Saga for service confirmation/assignment (CU15) are architectural requirements.
- S3 evidence storage is private and access-controlled. Database records hold references rather than evidence files.
- Offline support is bounded: web uses IndexedDB and mobile SQLite; pending local captures are not server confirmations. Scheduling, confirmation, and final charges require online validation. Synchronization must preserve operation identity, versions, dependencies, rejections, and conflicts.
- Visual AI is intended to run locally (TensorFlow.js on web, LiteRT on mobile) after model/data preparation; server AI and ML are also in scope. Model quality is not validated. Predictions and human corrections remain separate and carry model version; no accuracy, dataset, or completed training claim is established.
- Internal agents must work independently of the external MCP. CU25 must remain usable without MCP. Notes and AI outputs are untrusted data and do not grant authority.
- Charges apply to services only. Server-side authorization checks role, action, and record. Client accounts are not initially required.
- Product status is mixed and must be checked in `docs/context/STATUS.md`: that document records implemented, tested, partial, and open work. A planned or partially verified capability must not be represented as generally available.
- Open or incomplete: the status and acceptance of individual use cases; production readiness and deployment; reservation/cancellation/reassignment rules; payment installments and delivery policy; offline validity; and AI dataset, evaluation, and model quality. Consult current status and decisions before making claims.

## Evidence on Hand

The repository contains the product baseline in `docs/context/PROJECT.md`, implementation and verification status in `docs/context/STATUS.md`, and supporting decisions and evidence under `docs/decisions/` and `docs/evidence/`. These are scoped records of work, not blanket proof that all requirements are delivered. No approved customer testimonials, market benchmarks, pricing claims, or deployment claims are established here; do not fabricate them.

## Product Principles

- Serve one workshop's service operations; do not introduce retail or inventory workflows.
- Keep customer accounts optional at the outset and staff authorization explicit.
- Treat each service's data and business rules as owned by that service.
- Make offline work visibly pending until the server validates it; preserve conflicts and operation identity.
- Treat AI as assistive and unvalidated; preserve human correction independently from prediction.

# Backend Architecture Rules

This rule enforces the Modular Monolith (Microlith) architecture for Merchant Brain.

## Core Architectural Invariants

1. **One Application, One Deployment, One Database**:
   - The entire backend runs as a single deployable Next.js application backed by a single PostgreSQL database.
   - Do NOT introduce independent microservices, serverless function sprawl, or separate database instances.

2. **Domain Module Isolation**:
   - All business logic lives in `modules/<domain>/` with strict internal layering:
     - `domain/types.ts`: Pure domain entities, value objects, and branded IDs.
     - `domain/rules.ts`: Pure business invariants and validation logic.
     - `application/service.ts`: Use case orchestration and application workflows.
     - `infrastructure/repository.ts`: Database access and external adapter implementations.
     - `index.ts`: The ONLY public entry point for the module.

3. **Strict Boundary Enforcement**:
   - Modules MUST NOT import private internals of other modules (e.g., `modules/auth/infrastructure/...` is prohibited). All cross-module access must go through the root barrel `modules/auth/index.ts`.
   - Cross-module dependencies must respect the dependency matrix defined in `lib/boundaries.ts`. Circular dependencies are strictly forbidden.

4. **In-Process Event Bus**:
   - Decoupled asynchronous cross-module notifications must use the in-memory typed `EventBus` (`lib/events.ts`).
   - Do NOT introduce Kafka, RabbitMQ, SQS, or Redis Pub/Sub unless explicitly authorized for multi-instance scaling in production.

5. **Dependency Inversion via ModuleRegistry**:
   - Services must be registered and resolved through the centralized `ModuleRegistry` (`lib/registry.ts`).
   - The registry is frozen at runtime initialization (`freezeRegistry()`) to prevent dynamic mutation or service hijacking.

# CLAUDE.md — System Rules & Coding Standards

> These rules apply globally across the entire Pulse codebase.
> Claude must follow these unconditionally unless explicitly overridden in a task.

---

## Language & Runtime

- **TypeScript everywhere** — no plain `.js` files in source. `strict: true` in tsconfig.
- **Node.js 20+** (LTS). Use native `fetch` where possible, avoid polyfills.
- **ESM modules** preferred. Use `"type": "module"` in packages where feasible.

---

## Code Style

- **Formatter**: Prettier. Default config, 2-space indent, single quotes, no semicolons optional (pick one and lock it).
- **Linter**: ESLint with `@typescript-eslint` rules. No `any` without a comment explaining why.
- **Naming conventions**:
  - `camelCase` for variables and functions
  - `PascalCase` for classes, interfaces, types, React components
  - `SCREAMING_SNAKE_CASE` for constants and env var names
  - `kebab-case` for file names (e.g. `request-log.service.ts`)
- **No magic numbers** — extract to named constants.
- **No commented-out code** in commits — delete it.

---

## File & Folder Structure

- Group by **feature/domain**, not by type.
  - ✅ `src/projects/projects.service.ts`
  - ❌ `src/services/projects.ts`
- Keep files under 300 lines. Split if larger.
- Index files (`index.ts`) only for clean re-exports, not logic.

---

## Functions & Logic

- **Pure functions preferred** — no hidden side effects.
- **Early returns** over nested if-else.
- **Max function length**: ~40 lines. If longer, split it.
- Async functions must always handle errors — never unhandled promise rejections.
- Use `zod` for all runtime input validation (API inputs, env vars, SDK payloads).

---

## Error Handling

- Never swallow errors silently. Either handle them or let them bubble with context.
- Use a consistent error format across all APIs:
  ```ts
  { success: false, error: { code: string, message: string } }
  ```
- Log errors with structured logging (see Logging section).
- In the ingestion API specifically: **catch all errors internally** — never let an ingestion failure throw to the user's app.

---

## Environment Variables

- All env vars defined in a `.env.example` file at root.
- Validate env vars at startup using `zod`:
  ```ts
  const env = z.object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string(),
    // ...
  }).parse(process.env)
  ```
- Never access `process.env.SOMETHING` directly in business logic — always import from a central `env.ts`.

---

## Security

- **Never log secrets**, API keys, tokens, or passwords.
- **Never store plain API keys** — always hash with SHA-256 before DB writes.
- **Never expose internal stack traces** in API responses to clients.
- Sanitize all user inputs before DB writes.
- Use parameterized queries — Prisma handles this, but be careful with raw SQL.
- Strip sensitive headers (`Authorization`, `Cookie`, `X-Api-Key`) before storing request metadata.

---

## Logging

- Use **`pino`** for structured JSON logging (fast, Fastify-native).
- Log levels: `error`, `warn`, `info`, `debug`. Default to `info` in prod, `debug` in dev.
- Every log entry must include: `level`, `timestamp`, `service`, `message`, and relevant context.
- Never use `console.log` in production code — only in throwaway scripts.

---

## Testing

- **Unit tests**: Vitest (fast, ESM-native, compatible with Node 20).
- **Integration tests**: Supertest for HTTP layer.
- Test file naming: `*.test.ts` co-located with the file being tested.
- Aim for coverage on:
  - All service functions
  - All API route handlers
  - All queue workers
- Mock external services (DB, Redis, Stripe) in unit tests — never hit real services.

---

## Git & Commits

- **Conventional Commits** format:
  ```
  feat: add BullMQ worker for request log processing
  fix: correct hash comparison in API key validation
  chore: update prisma schema with UptimeCheck model
  ```
- Branches: `feat/`, `fix/`, `chore/`, `refactor/`
- Never commit `.env` files — only `.env.example`.
- PRs must have a short description of what changed and why.

---

## Dependencies

- **Prefer fewer, well-maintained packages** over micro-libraries.
- Always pin exact versions in production services (`"fastify": "4.26.1"` not `"^4"`).
- Run `npm audit` before any release.
- Do not add a new package without checking if it's already achievable with existing deps.

---

## Performance Defaults

- All DB queries must have a timeout set.
- Avoid N+1 queries — use Prisma `include` or batch queries.
- Any endpoint expected to be high-traffic must go through the Redis queue, not hit DB directly.
- Use connection pooling for Postgres (PgBouncer or Prisma's built-in pool).

---

## Claude-Specific Behaviour

- Always write **complete, working code** — no placeholders like `// TODO: implement this`.
- When generating a file, include all necessary imports.
- When modifying existing code, show only the changed section with enough surrounding context to locate it.
- Always explain **why** a decision was made if it's non-obvious.
- If a task spans multiple files, list all files that need to change before writing code.
- Default to the **simplest working implementation first**, then suggest optimizations separately.
- If something in the instructions conflicts with best practices, flag it before proceeding.
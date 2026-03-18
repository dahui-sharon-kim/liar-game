# Liar Game Online

## Environment & Stack

- **Package manager**: pnpm (Never use npm/yarn)
- **Frontend**: Next.js App Router (Never use Pages Router)
- **Backend**: NestJS
- **Monorepo**: Turbo

## Directory Structure

- `packages/types`: Shared TypeScript interfaces/types. **Check here before creating local types.**
- `frontend/utils`: Pure, generic functions (e.g., `formatCurrency`). No external dependencies allowed.
- `frontend/lib`: Domain-specific logic, wrappers for external SDKs, and business calculations.

## Code Quality Standards

- **File Length**: Maximum 350 lines. If exceeded, refactor into smaller sub-components or hooks.
- **Naming**: Use kebab-case for **filenames and directories**. Use PascalCase for Components & Classes inside the code.

### Backend

- **Pattern**: Controller - Service - Repository.
- **Validation**: Strict use of DTOs with `class-validator` for all inputs.
- **Dependency Injection**: Use Constructor Injection exclusively.
- **Errors**: Use built-in Nest `HttpException` classes.

### Frontend

- **Structure**: Group code by **Feature** rather than File Type
  - `src/features/[name]`: Components, hooks, & logic for a domain (e.g., `game-lobby`, `voting`, `chat`).
  - `app/`: Used only for Routing and Layouts. Keep logic in `app/` to a minimum; delegate to Features.
- **State**: Prefer Server Components for data fetching. Use 'use client' only when interaction is required.
- **Hooks**: Avoid `useEffect` for state synchronization. Use it only for external system subscriptions (e.g., Socket.io, Timers).
- **Validation**: Use Zod for runtime validation (especially API responses and Socket events).

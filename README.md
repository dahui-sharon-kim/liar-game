# Liar Game Web

## Description

- 라이어 게임을 온라인으로 제공합니다.
- socket.io를 사용한 실시간 투표, 채팅 기능 등이 구현되어 있습니다.

## Architecture

```
[ Next.js Client ]
        |
   Socket.io + HTTP
        |
[ NestJS GameServer ]
        |
------------------------------
|          |                 |
Postgres   Redis(optional)  Auth0
(durable)  (ephemeral)      (identity)
```

## Structure

```
repo/
  apps/
    backend/             # NestJS
    frontend/            # Next.js (App Router)
  packages/
    shared-types/        # phase enums, WS event types, DTO schemas
    shared-utils/        # common helpers
    eslint-config/
    tsconfig/
  infra/
    docker-compose.yaml
    nginx/
```

## Development Guide

- [Commit Convention](./docs/commit-convention.md)

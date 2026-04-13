# Design: Rust + WebSocket Migration

**Date:** 2026-04-13
**Scope:** Replace NestJS/Socket.IO backend with Rust/Axum; replace `socket.io-client` on the frontend with native WebSocket.

---

## 1. Overall Structure

### What changes
| Location | Before | After |
|---|---|---|
| `apps/backend/` | NestJS + Socket.IO | deleted |
| `apps/backend-rs/` | (none) | Rust + Axum |
| `apps/frontend/lib/game-socket.ts` | `socket.io-client` wrapper | native `WebSocket` class |
| `apps/frontend/app/game-context.tsx` | Socket.IO event wiring | native WS event wiring |
| `apps/frontend/package.json` | depends on `socket.io-client` | dependency removed |

### What stays the same
- All game logic (FSM, room state machine) — ported 1:1 from TypeScript to Rust
- All message event names (`room:create`, `room:join`, `room:state`, `room:private`, etc.)
- All React components — untouched

### Rust crate layout
```
apps/backend-rs/
├── Cargo.toml
└── src/
    ├── main.rs          # Axum server setup, route registration
    ├── state.rs         # AppState definition (DashMap rooms + senders + nonces + timers)
    ├── ws.rs            # WebSocket upgrade handler, connection lifecycle
    ├── protocol.rs      # ClientMsg / AckMsg / PushMsg serde types
    ├── handlers.rs      # one function per client message type
    └── room/
        ├── mod.rs       # dispatch() — routes GameEvent → ApplyResult
        ├── fsm.rs       # game state machine transitions
        └── types.rs     # RoomState, GameEvent, GameAction, ApplyResult
```

---

## 2. AppState & Connection Lifecycle

### AppState
Shared via `Arc<AppState>`. No top-level `Mutex` — `DashMap` handles per-shard locking.

```rust
pub struct AppState {
    /// roomCode → RoomState
    pub rooms: DashMap<String, RoomState>,
    /// socketId → roomCode (reverse index for disconnect lookup)
    pub socket_to_room: DashMap<String, String>,
    /// socketId → outgoing message sender (mpsc channel to the WS writer task)
    pub senders: DashMap<String, mpsc::UnboundedSender<Message>>,
    /// socketId → reconnect nonce
    pub nonces: DashMap<String, String>,
    /// (roomCode, TimeoutKind) → CancellationToken (for CANCEL_TIMEOUT actions)
    pub timers: DashMap<(String, TimeoutKind), CancellationToken>,
}
```

### Per-connection lifecycle
1. WS upgrade request hits `GET /game` → Axum upgrades the connection
2. Generate a `socketId` (UUID v4)
3. Split socket into sink + stream; create an `mpsc::unbounded_channel`
4. Spawn a **writer task**: drains the channel receiver into the WS sink
5. Store the channel sender in `state.senders[socketId]`
6. Send `server:hello` push immediately
7. **Reader loop**: for each text frame, parse as `ClientMsg { id, type, payload }` and dispatch to the matching handler in `handlers.rs`
8. Handler returns an `AckMsg` — serialize and send via the socket's channel sender
9. Handler may also call `state.broadcast()` or `state.emit_to()` for side-effect pushes
10. On stream end/error: run disconnect logic, remove from `senders` and `socket_to_room`, cancel all room timers if room is now empty

### Broadcasting helpers on AppState
```rust
impl AppState {
    /// Send a push to every player currently in the room.
    /// `RoomState` exposes a `players(&self) -> &[PlayerState]` method that
    /// delegates to each variant's inner state.
    pub fn broadcast(&self, room_code: &str, msg: &PushMsg) {
        if let Some(room) = self.rooms.get(room_code) {
            for player in room.players() {
                self.emit_to(&player.socket_id, msg);
            }
        }
    }

    /// Send a push to a single socket.
    pub fn emit_to(&self, socket_id: &str, msg: &PushMsg) {
        if let Some(tx) = self.senders.get(socket_id) {
            let _ = tx.send(Message::Text(serde_json::to_string(msg).unwrap()));
        }
    }
}
```

---

## 3. Protocol & Message Types

### Wire format

**Client → Server (every message has a correlation ID):**
```json
{ "id": "abc123", "type": "room:create", "payload": { "name": "Alice" } }
```

**Server → Client — ack (carries the same `id`):**
```json
{ "id": "abc123", "ok": true,  "data": { "roomCode": "XYZ", "room": { ... } } }
{ "id": "abc123", "ok": false, "error": { "code": "BAD_REQUEST", "message": "name is required" } }
```

**Server → Client — push (no `id`, distinguished by `type`):**
```json
{ "type": "server:hello",  "data": { "socketId": "...", "reconnectNonce": "...", "ts": 0 } }
{ "type": "room:state",    "data": { ... } }
{ "type": "room:private",  "data": { ... } }
```

### Rust types (`protocol.rs`)
```rust
/// Incoming from client
#[derive(Deserialize)]
pub struct ClientMsg {
    pub id:      String,
    #[serde(rename = "type")]
    pub kind:    String,
    pub payload: Option<serde_json::Value>,
}

/// Outgoing ack (untagged so serde produces flat JSON)
#[derive(Serialize)]
#[serde(untagged)]
pub enum AckMsg {
    Ok  { id: String, ok: bool, data:  serde_json::Value },
    Err { id: String, ok: bool, error: AckError },
}

#[derive(Serialize)]
pub struct AckError { pub code: String, pub message: String }

/// Outgoing push
#[derive(Serialize)]
pub struct PushMsg {
    #[serde(rename = "type")]
    pub kind: String,
    pub data: serde_json::Value,
}
```

### Helper constructors
```rust
pub fn ack_ok(id: String, data: impl Serialize) -> AckMsg {
    AckMsg::Ok { id, ok: true, data: serde_json::to_value(data).unwrap() }
}
pub fn ack_err(id: String, code: &str, message: &str) -> AckMsg {
    AckMsg::Err { id, ok: false, error: AckError { code: code.into(), message: message.into() } }
}
pub fn push(kind: &str, data: impl Serialize) -> PushMsg {
    PushMsg { kind: kind.into(), data: serde_json::to_value(data).unwrap() }
}
```

---

## 4. Game Logic Port (FSM + Room Service)

The TypeScript FSM and RoomService port 1:1 to Rust with the same structure and event/action types.

### `room/types.rs`
```rust
pub enum RoomState {
    Lobby(LobbyState),
    DealRole(DealRoleState),
    Discussion(DiscussionState),
    VoteOpen(VoteOpenState),
    VoteResolve(VoteResolveState),
    End(EndState),
}

pub enum GameEvent {
    PlayerJoin    { socket_id: String, name: String, at: u64 },
    PlayerLeave   { socket_id: String, at: u64 },
    ReadyOn       { socket_id: String, at: u64 },
    ReadyOff      { socket_id: String, at: u64 },
    StartGame     { socket_id: String, at: u64 },
    SubmitAction  { socket_id: String, action: serde_json::Value, at: u64 },
    SubmitVote    { socket_id: String, target_socket_id: Option<String>, at: u64 },
    CancelVote    { socket_id: String, at: u64 },
    Timeout       { kind: TimeoutKind, at: u64 },
    Disconnect    { socket_id: String, at: u64 },
    Reconnect     { socket_id: String, new_socket_id: String, at: u64 },
}

pub enum GameAction {
    BroadcastPublicState,
    EmitPrivateState    { socket_id: String },
    ScheduleTimeout     { kind: TimeoutKind, ms: u64 },
    CancelTimeout       { kind: TimeoutKind },
    PersistMatchResult,
}

pub struct ApplyResult {
    pub room:    RoomState,
    pub actions: Vec<GameAction>,
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub enum TimeoutKind { DealRole, Discussion, Vote, VoteResolve }
```

### `room/mod.rs` — dispatch
```rust
pub fn dispatch(room: RoomState, event: GameEvent) -> Result<ApplyResult, (&'static str, String)>
```
Returns `Err((code, message))` on validation failure (mirrors the TypeScript `fail()` helper).

### `handlers.rs` — one async fn per message type
```rust
pub async fn handle(state: Arc<AppState>, socket_id: String, msg: ClientMsg) -> AckMsg {
    match msg.kind.as_str() {
        "room:create"      => handle_create_room(state, socket_id, msg.id, msg.payload).await,
        "room:join"        => handle_join_room(state, socket_id, msg.id, msg.payload).await,
        "room:leave"       => handle_leave(state, socket_id, msg.id).await,
        "room:ready"       => handle_ready(state, socket_id, msg.id, msg.payload).await,
        "room:start"       => handle_start(state, socket_id, msg.id).await,
        "room:vote"        => handle_vote(state, socket_id, msg.id, msg.payload).await,
        "room:vote:cancel" => handle_cancel_vote(state, socket_id, msg.id).await,
        "room:reconnect"   => handle_reconnect(state, socket_id, msg.id, msg.payload).await,
        _                  => ack_err(msg.id, "UNKNOWN_EVENT", "unknown event type"),
    }
}
```

Each handler follows this pattern:
1. Parse and validate payload
2. Look up room via `state.socket_to_room` or payload
3. Call `room::dispatch(room, event)`
4. Call `state.apply_actions(room_code, actions)` for side effects
5. Return `ack_ok` or `ack_err`

### Timer side effects (`state.apply_actions`)
- `ScheduleTimeout { kind, ms }`: spawn a `tokio::spawn` task with a `CancellationToken`; on fire, call `room::dispatch(room, GameEvent::Timeout { kind })` and recurse into `apply_actions`
- `CancelTimeout { kind }`: cancel the token stored in `state.timers`

---

## 5. Frontend Migration

### `lib/game-socket.ts` — full rewrite
```ts
type PushHandler = (data: unknown) => void;

class GameSocket {
  readonly ws: WebSocket;
  private pending   = new Map<string, (ack: unknown) => void>();
  private listeners = new Map<string, PushHandler>();

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if ("id" in msg) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      } else {
        this.listeners.get(msg.type)?.(msg.data);
      }
    };
  }

  on(type: string, handler: PushHandler)  { this.listeners.set(type, handler); }
  off(type: string)                        { this.listeners.delete(type); }
  disconnect()                             { this.ws.close(); }

  emitAck<TResponse>(type: string, payload?: unknown): Promise<Ack<TResponse>> {
    const id = crypto.randomUUID();
    this.ws.send(JSON.stringify({ id, type, payload }));
    return new Promise((resolve) => this.pending.set(id, resolve as (v: unknown) => void));
  }
}

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? "ws://localhost:4000";

export function createGameSocket(): GameSocket {
  return new GameSocket(`${GAME_SERVER_URL}/game`);
}

export { GAME_SERVER_URL };
```

### `app/game-context.tsx` — connection wiring changes only
| Before (Socket.IO) | After (native WS) |
|---|---|
| `socket.on("connect", ...)` | `ws.ws.onopen = ...` |
| `socket.on("disconnect", ...)` | `ws.ws.onclose = ...` |
| `socket.on("connect_error", ...)` | `ws.ws.onerror = ...` |
| `socket.on("server:hello", h)` | `ws.on("server:hello", h)` |
| `socket.on("room:state", h)` | `ws.on("room:state", h)` |
| `socket.on("room:private", h)` | `ws.on("room:private", h)` |
| `emitAck(socket, "room:create", p)` | `ws.emitAck("room:create", p)` |
| `socket.disconnect()` | `ws.disconnect()` |

### Package changes
- Remove `socket.io-client` from `apps/frontend/package.json`
- No new packages needed — `WebSocket` is a browser built-in

---

## 6. Key Dependencies (Rust)

```toml
[dependencies]
axum            = { version = "0.8", features = ["ws"] }
tokio           = { version = "1",   features = ["full"] }
tokio-util      = "0.7"
serde           = { version = "1",   features = ["derive"] }
serde_json      = "1"
dashmap         = "6"
uuid            = { version = "1",   features = ["v4"] }
tower-http      = { version = "0.6", features = ["cors"] }
```

---

## 7. Out of Scope

- Persistence / database — `PersistMatchResult` remains a no-op placeholder
- Authentication — reconnect nonce system is preserved as-is
- HTTP endpoints — none currently exist, none added
- The old `apps/backend/` NestJS code is deleted as part of this migration

export type RoomStateKind = "LOBBY" | "DEAL_ROLE" | "DISCUSSION_ROUND" | "VOTE_OPEN" | "VOTE_RESOLVE" | "END";

export type PlayerRole = "LIAR" | "CIVILIAN";

export type PlayerState = {
  socketId: string;
  name: string;
  joinedAt: number;
  isReady: boolean;
  alive: boolean;
  role?: PlayerRole;
};

export type RoomStateBase = {
  roomCode: string;
  hostSocketId: string;
  createdAt: number;
  round: number;
  players: PlayerState[];
  lastEventAt: number;
};

export type LobbyState = RoomStateBase & { kind: "LOBBY" };
export type DealRoleState = RoomStateBase & { kind: "DEAL_ROLE" };
export type DiscussionState = RoomStateBase & {
  kind: "DISCUSSION_ROUND";
  discussionEndsAt?: number;
};
export type VoteOpenState = RoomStateBase & {
  kind: "VOTE_OPEN";
  votes: Record<string, string | null>;
  voteEndsAt?: number;
};
export type VoteResolveState = RoomStateBase & {
  kind: "VOTE_RESOLVE";
  votes: Record<string, string | null>;
  tally: Record<string, number>;
  eliminated?: string;
  resolveEndsAt?: number;
};
export type EndState = RoomStateBase & {
  kind: "END";
  winner: "LIARS" | "CIVILIANS";
  eliminated?: string;
};

export type RoomState = LobbyState | DealRoleState | DiscussionState | VoteOpenState | VoteResolveState | EndState;

// ---------- Public / Private snapshots ----------

export type PublicPlayerState = Omit<PlayerState, "role">;

// Key fix: distributive omit over unions.
type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;

/**
 * RoomState의 유니온 구조는 유지하면서, 각 상태의 players만 role이 없는 공개용 타입 PublicPlayerState으로 바꾼 것.
 * 따라서 vote states들은 여전히 `votes`가 있고 resolve states들은 여전히 `tally`가 있는 등 유지됨.
 */
export type PublicRoomSnapshot = RoomState extends infer R
  ? R extends RoomState
    ? DistributiveOmit<R, "players"> & { players: PublicPlayerState[] }
    : never
  : never;

export type PrivateRoomSnapshot = PublicRoomSnapshot & {
  self?: { socketId: string; role?: PlayerRole };
};

// ---------- Timing / events / actions ----------

export type TimeoutKind = "DEAL_ROLE" | "DISCUSSION" | "VOTE" | "VOTE_RESOLVE";

export type GameEvent =
  | { type: "PLAYER_JOIN"; socketId: string; name: string; at: number }
  | { type: "PLAYER_LEAVE"; socketId: string; at: number }
  | { type: "READY_ON"; socketId: string; at: number }
  | { type: "READY_OFF"; socketId: string; at: number }
  | { type: "START_GAME"; socketId: string; at: number }
  | { type: "SUBMIT_ACTION"; socketId: string; action: unknown; at: number }
  | { type: "SUBMIT_VOTE"; socketId: string; targetSocketId: string | null; at: number }
  | { type: "CANCEL_VOTE"; socketId: string; at: number }
  | { type: "TIMEOUT"; kind: TimeoutKind; at: number }
  | { type: "DISCONNECT"; socketId: string; at: number }
  | { type: "RECONNECT"; socketId: string; newSocketId: string; at: number };

export type GameAction =
  | { type: "BROADCAST_PUBLIC_STATE" }
  | { type: "EMIT_PRIVATE_STATE"; socketId: string }
  | { type: "SCHEDULE_TIMEOUT"; kind: TimeoutKind; ms: number }
  | { type: "CANCEL_TIMEOUT"; kind: TimeoutKind }
  | { type: "PERSIST_MATCH_RESULT" };

export type ApplyResult =
  | { ok: true; room: RoomState; actions: GameAction[] }
  | { ok: false; reason: string; code?: string };

// ---------- Ack helpers ----------

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Ack<never> {
  return { ok: false, error: { code, message } };
}

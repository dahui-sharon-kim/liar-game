import type {
  ApplyResult,
  DealRoleState,
  DiscussionState,
  EndState,
  GameAction,
  GameEvent,
  LobbyState,
  PlayerState,
  PrivateRoomSnapshot,
  PublicRoomSnapshot,
  RoomState,
  RoomStateBase,
  TimeoutKind,
  VoteOpenState,
  VoteResolveState,
} from "../types";

// Tunable timings for an MVP. Keep small for faster tests/dev.
const MIN_PLAYERS_TO_START = 3;
const DEAL_ROLE_MS = 1_000;
const DISCUSSION_MS = 30_000;
const VOTE_MS = 20_000;
const VOTE_RESOLVE_MS = 3_000;

const timeoutKinds: TimeoutKind[] = ["DEAL_ROLE", "DISCUSSION", "VOTE", "VOTE_RESOLVE"];

export function buildLobbyState(roomCode: string, hostSocketId: string, hostName: string, now: number): LobbyState {
  const host: PlayerState = {
    socketId: hostSocketId,
    name: hostName,
    joinedAt: now,
    isReady: false,
    alive: true,
  };

  return {
    kind: "LOBBY",
    roomCode,
    hostSocketId,
    createdAt: now,
    round: 0,
    players: [host],
    lastEventAt: now,
  };
}

export function toPublicState(room: RoomState): PublicRoomSnapshot {
  const base = {
    ...room,
    players: room.players.map(({ socketId, name, joinedAt, isReady, alive }) => {
      return { socketId, name, joinedAt, isReady, alive };
    }),
  };

  // Mask votes in vote states (do not reveal targets in public).
  if (room.kind === "VOTE_OPEN" || room.kind === "VOTE_RESOLVE") {
    return { ...base, votes: maskVotes(room.votes) } as VoteOpenState | VoteResolveState;
  }

  return base;
}

export function toPrivateState(room: RoomState, socketId: string): PrivateRoomSnapshot {
  const self = room.players.find((p) => p.socketId === socketId);
  return {
    ...toPublicState(room),
    self: self ? { socketId, role: self.role } : undefined,
  };
}

/**
 * Apply a domain event to the room. Must be the ONLY path to mutate state.
 * - Leave/disconnect: hard remove (MVP choice).
 * - TIMEOUT: should be safe against stale timers.
 */
export function applyEvent(room: RoomState, event: GameEvent): ApplyResult {
  // Allow hard exits in any state (MVP).
  if (event.type === "PLAYER_LEAVE" || event.type === "DISCONNECT") {
    return removePlayer(room, event.socketId, event.at);
  }

  // Treat stale timeouts as no-ops (canceled timers can still fire).
  if (event.type === "TIMEOUT" && !isExpectedTimeout(room, event.kind)) {
    return okResult(room, []);
  }

  switch (room.kind) {
    case "LOBBY":
      return lobbyReducer(room, event);
    case "DEAL_ROLE":
      return dealRoleReducer(room, event);
    case "DISCUSSION_ROUND":
      return discussionReducer(room, event);
    case "VOTE_OPEN":
      return voteOpenReducer(room, event);
    case "VOTE_RESOLVE":
      return voteResolveReducer(room, event);
    case "END":
      return endReducer(room, event);
    default:
      return { ok: false, reason: "UNKNOWN_STATE" };
  }
}

function isExpectedTimeout(room: RoomState, kind: TimeoutKind): boolean {
  switch (room.kind) {
    case "DEAL_ROLE":
      return kind === "DEAL_ROLE";
    case "DISCUSSION_ROUND":
      return kind === "DISCUSSION";
    case "VOTE_OPEN":
      return kind === "VOTE";
    case "VOTE_RESOLVE":
      return kind === "VOTE_RESOLVE";
    default:
      return false;
  }
}

function lobbyReducer(room: LobbyState, event: GameEvent): ApplyResult {
  switch (event.type) {
    case "PLAYER_JOIN": {
      if (room.players.some((p) => p.socketId === event.socketId)) {
        return { ok: false, reason: "ALREADY_IN_ROOM", code: "CONFLICT" };
      }

      const next: LobbyState = {
        ...room,
        players: [
          ...room.players,
          { socketId: event.socketId, name: event.name, joinedAt: event.at, isReady: false, alive: true },
        ],
        lastEventAt: event.at,
      };

      return okResult(next, [{ type: "BROADCAST_PUBLIC_STATE" }]);
    }

    case "READY_ON":
    case "READY_OFF": {
      const target = room.players.find((p) => p.socketId === event.socketId);
      if (!target) return { ok: false, reason: "NOT_IN_ROOM", code: "NOT_FOUND" };

      const next: LobbyState = {
        ...room,
        players: room.players.map((p) =>
          p.socketId === event.socketId ? { ...p, isReady: event.type === "READY_ON" } : p,
        ),
        lastEventAt: event.at,
      };

      return okResult(next, [{ type: "BROADCAST_PUBLIC_STATE" }]);
    }

    case "START_GAME": {
      if (event.socketId !== room.hostSocketId) return { ok: false, reason: "ONLY_HOST_CAN_START", code: "FORBIDDEN" };
      if (room.players.length < MIN_PLAYERS_TO_START)
        return { ok: false, reason: "NOT_ENOUGH_PLAYERS", code: "PRECONDITION_FAILED" };
      if (!room.players.every((p) => p.isReady || p.socketId === room.hostSocketId)) {
        return { ok: false, reason: "NOT_EVERYONE_READY", code: "PRECONDITION_FAILED" };
      }

      const withRoles = assignRoles(room.players);

      const next: DealRoleState = {
        ...room,
        kind: "DEAL_ROLE",
        round: 1,
        players: withRoles.map((p) => ({ ...p, isReady: false, alive: true })),
        lastEventAt: event.at,
      };

      const actions: GameAction[] = [
        { type: "BROADCAST_PUBLIC_STATE" },
        ...withRoles.map((p) => ({ type: "EMIT_PRIVATE_STATE" as const, socketId: p.socketId })),
        { type: "SCHEDULE_TIMEOUT", kind: "DEAL_ROLE", ms: DEAL_ROLE_MS },
      ];

      return okResult(next, actions);
    }

    default:
      return wrongState(event);
  }
}

function dealRoleReducer(room: DealRoleState, event: GameEvent): ApplyResult {
  if (event.type === "TIMEOUT" && event.kind === "DEAL_ROLE") {
    const next: DiscussionState = {
      ...room,
      kind: "DISCUSSION_ROUND",
      discussionEndsAt: event.at + DISCUSSION_MS,
      lastEventAt: event.at,
    };

    const actions: GameAction[] = [
      { type: "BROADCAST_PUBLIC_STATE" },
      { type: "SCHEDULE_TIMEOUT", kind: "DISCUSSION", ms: DISCUSSION_MS },
    ];

    return okResult(next, actions);
  }

  return wrongState(event);
}

function discussionReducer(room: DiscussionState, event: GameEvent): ApplyResult {
  if (event.type === "TIMEOUT" && event.kind === "DISCUSSION") {
    const votes = Object.fromEntries(room.players.filter((p) => p.alive).map((p) => [p.socketId, null])) as Record<
      string,
      string | null
    >;

    const next: VoteOpenState = {
      ...room,
      kind: "VOTE_OPEN",
      votes,
      voteEndsAt: event.at + VOTE_MS,
      lastEventAt: event.at,
    };

    const actions: GameAction[] = [
      { type: "BROADCAST_PUBLIC_STATE" },
      { type: "SCHEDULE_TIMEOUT", kind: "VOTE", ms: VOTE_MS },
    ];

    return okResult(next, actions);
  }

  if (event.type === "SUBMIT_ACTION") {
    // MVP: allow chat/actions without changing state.
    return okResult({ ...room, lastEventAt: event.at }, []);
  }

  return wrongState(event);
}

function voteOpenReducer(room: VoteOpenState, event: GameEvent): ApplyResult {
  if (event.type === "SUBMIT_VOTE") {
    if (!room.players.some((p) => p.socketId === event.socketId && p.alive)) {
      return { ok: false, reason: "NOT_ELIGIBLE", code: "FORBIDDEN" };
    }
    if (event.targetSocketId && !room.players.some((p) => p.socketId === event.targetSocketId && p.alive)) {
      return { ok: false, reason: "INVALID_TARGET", code: "BAD_REQUEST" };
    }

    const votes = { ...room.votes, [event.socketId]: event.targetSocketId };
    const nextRoom: VoteOpenState = { ...room, votes, lastEventAt: event.at };

    if (allAliveVoted(nextRoom)) {
      return resolveVotes(nextRoom, event.at, [{ type: "CANCEL_TIMEOUT", kind: "VOTE" }]);
    }

    return okResult(nextRoom, [{ type: "BROADCAST_PUBLIC_STATE" }]);
  }

  if (event.type === "CANCEL_VOTE") {
    if (!(event.socketId in room.votes)) return { ok: false, reason: "NOT_ELIGIBLE", code: "FORBIDDEN" };
    const next: VoteOpenState = { ...room, votes: { ...room.votes, [event.socketId]: null }, lastEventAt: event.at };
    return okResult(next, [{ type: "BROADCAST_PUBLIC_STATE" }]);
  }

  if (event.type === "TIMEOUT" && event.kind === "VOTE") {
    return resolveVotes(room, event.at, [{ type: "CANCEL_TIMEOUT", kind: "VOTE" }]);
  }

  return wrongState(event);
}

function voteResolveReducer(room: VoteResolveState, event: GameEvent): ApplyResult {
  if (event.type === "TIMEOUT" && event.kind === "VOTE_RESOLVE") {
    return advanceFromVoteResolve(room, event.at);
  }

  return wrongState(event);
}

function endReducer(room: EndState, event: GameEvent): ApplyResult {
  // Leave/disconnect already handled in applyEvent() as hard exits.
  // Everything else is rejected (unless you add RESTART_GAME later).
  return { ok: false, reason: `WRONG_STATE_FOR_${event.type}` };
}

function removePlayer(room: RoomState, socketId: string, at: number): ApplyResult {
  if (!room.players.some((p) => p.socketId === socketId))
    return { ok: false, reason: "NOT_IN_ROOM", code: "NOT_FOUND" };

  const remaining = room.players.filter((p) => p.socketId !== socketId);
  const newHostSocketId = room.hostSocketId === socketId ? (remaining[0]?.socketId ?? "") : room.hostSocketId;

  const base: RoomStateBase = {
    roomCode: room.roomCode,
    hostSocketId: newHostSocketId,
    createdAt: room.createdAt,
    round: room.round,
    players: remaining,
    lastEventAt: at,
  };

  // Preserve state-specific fields correctly.
  let next: RoomState;
  switch (room.kind) {
    case "LOBBY":
      next = { ...base, kind: "LOBBY" };
      break;

    case "DEAL_ROLE":
      next = { ...base, kind: "DEAL_ROLE" };
      break;

    case "DISCUSSION_ROUND":
      next = { ...base, kind: "DISCUSSION_ROUND", discussionEndsAt: room.discussionEndsAt };
      break;

    case "VOTE_OPEN": {
      const votes = removeFromVotes(room.votes, socketId);
      next = { ...base, kind: "VOTE_OPEN", votes, voteEndsAt: room.voteEndsAt };
      break;
    }

    case "VOTE_RESOLVE": {
      const votes = removeFromVotes(room.votes, socketId);
      next = {
        ...base,
        kind: "VOTE_RESOLVE",
        votes,
        tally: room.tally,
        eliminated: room.eliminated === socketId ? undefined : room.eliminated,
        resolveEndsAt: room.resolveEndsAt,
      };
      break;
    }

    case "END":
      next = { ...base, kind: "END", winner: room.winner };
      break;

    default:
      return { ok: false, reason: "UNKNOWN_STATE" };
  }

  // If empty room, cancel all timers. RoomService can delete the room after.
  if (remaining.length === 0) return okResult(next, cancelAllTimers());

  // Win-condition check only makes sense after roles exist (i.e., non-LOBBY).
  if (next.kind !== "LOBBY") {
    const liarAlive = next.players.some((p) => p.role === "LIAR" && p.alive);
    const civAlive = next.players.some((p) => p.role !== "LIAR" && p.alive);

    if (!liarAlive) {
      const endState: EndState = { ...base, kind: "END", winner: "CIVILIANS" };
      return okResult(endState, cancelAllTimers().concat([{ type: "BROADCAST_PUBLIC_STATE" }]));
    }

    if (!civAlive) {
      const endState: EndState = { ...base, kind: "END", winner: "LIARS" };
      return okResult(endState, cancelAllTimers().concat([{ type: "BROADCAST_PUBLIC_STATE" }]));
    }
  }

  return okResult(next, [{ type: "BROADCAST_PUBLIC_STATE" }]);
}

function removeFromVotes(votes: Record<string, string | null>, removedId: string): Record<string, string | null> {
  const next = { ...votes };
  delete next[removedId];
  for (const voter of Object.keys(next)) {
    if (next[voter] === removedId) next[voter] = null;
  }
  return next;
}

function resolveVotes(room: VoteOpenState, at: number, prependActions: GameAction[]): ApplyResult {
  const tally = countVotes(room.votes);
  const eliminated = pickElimination(tally);

  const players = eliminated
    ? room.players.map((p) => (p.socketId === eliminated ? { ...p, alive: false } : p))
    : room.players;

  const next: VoteResolveState = {
    ...room,
    kind: "VOTE_RESOLVE",
    votes: room.votes,
    tally,
    eliminated: eliminated ?? undefined,
    resolveEndsAt: at + VOTE_RESOLVE_MS,
    players,
    lastEventAt: at,
  };

  const actions: GameAction[] = [
    ...prependActions,
    { type: "BROADCAST_PUBLIC_STATE" },
    { type: "SCHEDULE_TIMEOUT", kind: "VOTE_RESOLVE", ms: VOTE_RESOLVE_MS },
  ];

  return okResult(next, actions);
}

function advanceFromVoteResolve(room: VoteResolveState, at: number): ApplyResult {
  const liarAlive = room.players.some((p) => p.role === "LIAR" && p.alive);
  const civAlive = room.players.some((p) => p.role !== "LIAR" && p.alive);

  if (!liarAlive || !civAlive || room.players.filter((p) => p.alive).length <= 2) {
    const next: EndState = { ...room, kind: "END", winner: liarAlive ? "LIARS" : "CIVILIANS", lastEventAt: at };
    return okResult(next, cancelAllTimers().concat([{ type: "BROADCAST_PUBLIC_STATE" }]));
  }

  const next: DiscussionState = {
    ...room,
    kind: "DISCUSSION_ROUND",
    round: room.round + 1,
    discussionEndsAt: at + DISCUSSION_MS,
    lastEventAt: at,
  };

  const actions: GameAction[] = [
    { type: "BROADCAST_PUBLIC_STATE" },
    { type: "SCHEDULE_TIMEOUT", kind: "DISCUSSION", ms: DISCUSSION_MS },
  ];

  return okResult(next, actions);
}

function assignRoles(players: PlayerState[]): PlayerState[] {
  const liarIndex = Math.floor(Math.random() * players.length);
  return players.map((p, idx) => ({
    ...p,
    role: idx === liarIndex ? "LIAR" : "CIVILIAN",
    alive: true,
    isReady: false,
  }));
}

function countVotes(votes: Record<string, string | null>): Record<string, number> {
  const tally: Record<string, number> = {};
  Object.values(votes)
    .filter((v): v is string => !!v)
    .forEach((target) => {
      tally[target] = (tally[target] ?? 0) + 1;
    });
  return tally;
}

function pickElimination(tally: Record<string, number>): string | null {
  let best: { id: string; votes: number } | null = null;
  let tie = false;

  for (const [id, votes] of Object.entries(tally)) {
    if (!best || votes > best.votes) {
      best = { id, votes };
      tie = false;
    } else if (best && votes === best.votes) {
      tie = true;
    }
  }

  if (!best || tie) return null;
  return best.id;
}

function allAliveVoted(room: VoteOpenState): boolean {
  // “voted” means non-null target (no abstain). If you want abstain, change this definition.
  return room.players.filter((p) => p.alive).every((p) => room.votes[p.socketId] !== null);
}

function cancelAllTimers(): GameAction[] {
  return timeoutKinds.map((kind) => ({ type: "CANCEL_TIMEOUT", kind }));
}

function maskVotes(votes: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(votes).map(([voter, target]) => [voter, target ? "__SUBMITTED__" : null]));
}

function okResult<T extends RoomState>(room: T, actions: GameAction[]): ApplyResult {
  return { ok: true, room, actions };
}

function wrongState(event: GameEvent): ApplyResult {
  return { ok: false, reason: `WRONG_STATE_FOR_${event.type}` };
}

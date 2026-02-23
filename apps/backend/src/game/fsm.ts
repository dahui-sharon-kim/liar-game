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

// MVP용 조정 가능한 타이밍 값. 테스트/개발 속도를 위해 현재는 작게 유지.
const MIN_PLAYERS_TO_START = 3;
const DEAL_ROLE_MS = 1_000;
const DISCUSSION_MS = 30_000;
const VOTE_MS = 20_000;
const VOTE_RESOLVE_MS = 3_000;

const timeoutKinds: TimeoutKind[] = ["DEAL_ROLE", "DISCUSSION", "VOTE", "VOTE_RESOLVE"];

/**
 * 새 방 생성 시 초기 로비 상태 생성
 * - 호스트 플레이어 객체 생성
 * - round: 0
 * - players: [host]
 */
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

/**
 * - RoomState에서 players의 role을 감춤 (라이어/시민 숨김)
 * - 투표 상태(VOTE_OPEN, VOTE_RESOLVE)에서는 votes 마스킹
 */
export function toPublicState(room: RoomState): PublicRoomSnapshot {
  const base = {
    ...room,
    players: room.players.map(({ role: _role, ...rest }) => rest),
  };

  // 투표 상태에서는 투표 대상을 마스킹한다(공개 상태에선 대상 비공개).
  if (room.kind === "VOTE_OPEN" || room.kind === "VOTE_RESOLVE") {
    return { ...base, votes: maskVotes(room.votes) } as VoteOpenState | VoteResolveState;
  }

  return base;
}

/**
 * 현재 방에 일치하는 selfId의 플레이어가 있으면 self를 추가하고, 없으면 undefined로 지정한 RoomState 반환
 */
export function toPrivateState(room: RoomState, socketId: string): PrivateRoomSnapshot {
  const self = room.players.find((p) => p.socketId === socketId);
  return {
    ...toPublicState(room),
    self: self ? { socketId, role: self.role } : undefined,
  };
}

/**
 * 이벤트를 적용하는 함수. 상태 변경의 유일한 진입점.
 * - leave/disconnect: 즉시 제거(hard remove, MVP 정책)
 * - TIMEOUT: 오래된(취소된) 타이머 콜백이 와도 안전하게 처리되어야 함
 */
export function applyEvent(room: RoomState, event: GameEvent): ApplyResult {
  // 어떤 상태에서든 강제 퇴장을 허용한다(MVP 정책).
  if (event.type === "PLAYER_LEAVE" || event.type === "DISCONNECT") {
    return removePlayer(room, event.socketId, event.at);
  }

  if (event.type === "RECONNECT") {
    return reconnectPlayer(room, event.socketId, event.newSocketId, event.at);
  }

  // 오래된 타임아웃은 no-op으로 처리한다(이미 취소됐는데 늦게 도착한 타이머도 뒤늦게 실행될 수 있음).
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

/**
 * 현재 상태에서 해당 타이머 종류가 유효한지를 확인
 */
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

/**
 * - 대상 상태: LOBBY
 * - 처리 이벤트: PLAYER_JOIN, READY_ON, READY_OFF, START_GAME
 * - 나머지는 wrongState
 */
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
    // MVP: 채팅/행동 제출은 허용하지만 상태는 변경하지 않는다.
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
  // leave/disconnect는 이미 applyEvent()에서 강제 퇴장으로 처리됨.
  // 그 외 이벤트는 모두 거절(나중에 RESTART_GAME을 추가하기 전까지).
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

  // 상태별 필드를 올바르게 유지하면서 재구성한다.
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

  // 방이 비었으면 모든 타이머를 취소한다. 이후 RoomService가 방을 삭제할 수 있다.
  if (remaining.length === 0) return okResult(next, cancelAllTimers());

  // 승리 조건 검사는 역할이 존재하는 상태(즉, LOBBY 아님)에서만 의미가 있다.
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

function reconnectPlayer(room: RoomState, oldSocketId: string, newSocketId: string, at: number): ApplyResult {
  if (!room.players.some((p) => p.socketId === oldSocketId)) {
    return { ok: false, reason: "NOT_IN_ROOM", code: "NOT_FOUND" };
  }

  if (oldSocketId !== newSocketId && room.players.some((p) => p.socketId === newSocketId)) {
    return { ok: false, reason: "NEW_SOCKET_ALREADY_IN_ROOM", code: "CONFLICT" };
  }

  const players = room.players.map((p) => (p.socketId === oldSocketId ? { ...p, socketId: newSocketId } : p));
  const hostSocketId = room.hostSocketId === oldSocketId ? newSocketId : room.hostSocketId;

  const base: RoomStateBase = {
    roomCode: room.roomCode,
    hostSocketId,
    createdAt: room.createdAt,
    round: room.round,
    players,
    lastEventAt: at,
  };

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
    case "VOTE_OPEN":
      next = {
        ...base,
        kind: "VOTE_OPEN",
        votes: remapVoteRecord(room.votes, oldSocketId, newSocketId),
        voteEndsAt: room.voteEndsAt,
      };
      break;
    case "VOTE_RESOLVE":
      next = {
        ...base,
        kind: "VOTE_RESOLVE",
        votes: remapVoteRecord(room.votes, oldSocketId, newSocketId),
        tally: remapTallyRecord(room.tally, oldSocketId, newSocketId),
        eliminated: room.eliminated === oldSocketId ? newSocketId : room.eliminated,
        resolveEndsAt: room.resolveEndsAt,
      };
      break;
    case "END":
      next = {
        ...base,
        kind: "END",
        winner: room.winner,
        eliminated: room.eliminated === oldSocketId ? newSocketId : room.eliminated,
      };
      break;
    default:
      return { ok: false, reason: "UNKNOWN_STATE" };
  }

  const actions: GameAction[] =
    oldSocketId === newSocketId
      ? [{ type: "EMIT_PRIVATE_STATE", socketId: newSocketId }]
      : [{ type: "BROADCAST_PUBLIC_STATE" }, { type: "EMIT_PRIVATE_STATE", socketId: newSocketId }];

  return okResult(next, actions);
}

function removeFromVotes(votes: Record<string, string | null>, removedId: string): Record<string, string | null> {
  const next = { ...votes };
  delete next[removedId];
  for (const voter of Object.keys(next)) {
    if (next[voter] === removedId) next[voter] = null;
  }
  return next;
}

function remapVoteRecord(
  votes: Record<string, string | null>,
  oldSocketId: string,
  newSocketId: string,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(votes).map(([voter, target]) => [
      voter === oldSocketId ? newSocketId : voter,
      target === oldSocketId ? newSocketId : target,
    ]),
  );
}

function remapTallyRecord(
  tally: Record<string, number>,
  oldSocketId: string,
  newSocketId: string,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(tally).map(([target, count]) => [target === oldSocketId ? newSocketId : target, count]),
  );
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

/**
 * - 결과 공개 후 다음 라운드로 갈지 게임 종료할지 결정
 * - 종료 조건: 라이어 사망, 시민 전멸, 생존자 2명 이하
 * - 종료 시: END 상태, 모든 타이머 취소, Public state 브로드캐스트
 */
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

/**
 * 플레이어 중 랜덤 1명을 라이어로 지정
 */
function assignRoles(players: PlayerState[]): PlayerState[] {
  const liarIndex = Math.floor(Math.random() * players.length);
  return players.map((p, idx) => ({
    ...p,
    role: idx === liarIndex ? "LIAR" : "CIVILIAN",
    alive: true,
    isReady: false,
  }));
}

/**
 * Record<voter, target|null>을 Record<target, count>로 집계
 */
function countVotes(votes: Record<string, string | null>): Record<string, number> {
  const tally: Record<string, number> = {};
  Object.values(votes)
    .filter((v): v is string => !!v)
    .forEach((target) => {
      tally[target] = (tally[target] ?? 0) + 1;
    });
  return tally;
}

/**
 * - 최다 득표를 받은 탈락자 결정
 * - 최고 득표 1명이면 그 소켓ID를 반환하고, 동점이거나 표가 없으면 null 반환
 * @param tally
 * @returns id | null
 */
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

/**
 * 생존자 전원이 투표했는지 확인 (기권 비허용)
 */
function allAliveVoted(room: VoteOpenState): boolean {
  // 여기서 “투표 완료”는 target이 null이 아닌 상태를 의미한다(기권 없음).
  // 기권을 허용하려면 이 정의를 바꿔야 한다.
  return room.players.filter((p) => p.alive).every((p) => room.votes[p.socketId] !== null);
}

/**
 * - 모든 타이머 종류에 대한 CANCLE_TIMEOUT 액션 생성
 * - 방 비움, 게임 종료, 강제 정리 등
 */
function cancelAllTimers(): GameAction[] {
  return timeoutKinds.map((kind) => ({ type: "CANCEL_TIMEOUT", kind }));
}

/**
 * votes에서 value가 있으면 __SUBMITTED__로 마스킹
 */
function maskVotes(votes: Record<string, string | null>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(votes).map(([voter, target]) => [voter, target ? "__SUBMITTED__" : null]));
}

function okResult<T extends RoomState>(room: T, actions: GameAction[]): ApplyResult {
  return { ok: true, room, actions };
}

/**
 * 현재 상태에서 허용되지 않는 이벤트 에러 생성
 */
function wrongState(event: GameEvent): ApplyResult {
  return { ok: false, reason: `WRONG_STATE_FOR_${event.type}` };
}

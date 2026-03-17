export type PlayerRole = "LIAR" | "CIVILIAN";

export type PublicPlayerState = {
  socketId: string;
  name: string;
  joinedAt: number;
  isReady: boolean;
  alive: boolean;
};

type RoomStateBase<TKind extends string> = {
  kind: TKind;
  roomCode: string;
  hostSocketId: string;
  createdAt: number;
  round: number;
  players: PublicPlayerState[];
  lastEventAt: number;
};

export type LobbyRoomSnapshot = RoomStateBase<"LOBBY">;

export type DealRoleRoomSnapshot = RoomStateBase<"DEAL_ROLE">;

export type DiscussionRoomSnapshot = RoomStateBase<"DISCUSSION_ROUND"> & {
  discussionEndsAt?: number;
};

export type VoteOpenRoomSnapshot = RoomStateBase<"VOTE_OPEN"> & {
  votes: Record<string, string | null>;
  voteEndsAt?: number;
};

export type VoteResolveRoomSnapshot = RoomStateBase<"VOTE_RESOLVE"> & {
  votes: Record<string, string | null>;
  tally: Record<string, number>;
  eliminated?: string;
  resolveEndsAt?: number;
};

export type EndRoomSnapshot = RoomStateBase<"END"> & {
  winner: "LIARS" | "CIVILIANS";
  eliminated?: string;
};

export type PublicRoomSnapshot =
  | LobbyRoomSnapshot
  | DealRoleRoomSnapshot
  | DiscussionRoomSnapshot
  | VoteOpenRoomSnapshot
  | VoteResolveRoomSnapshot
  | EndRoomSnapshot;

export type PrivateRoomSnapshot = PublicRoomSnapshot & {
  self?: { socketId: string; role?: PlayerRole };
};

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export type ServerHello = {
  socketId: string;
  reconnectNonce: string;
  ts: number;
};

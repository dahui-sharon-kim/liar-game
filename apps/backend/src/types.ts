export type RoomPhase = "LOBBY" | "IN_GAME" | "FINISHED";

export type Player = {
  socketId: string;
  name: string;
  isReady: boolean;
  joinedAt: number;
};

export type RoomState = {
  roomCode: string;
  phase: RoomPhase;
  hostSocketId: string;
  createdAt: number;
  players: Player[];
};

export type Ack<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): Ack<never> {
  return { ok: false, error: { code, message } };
}

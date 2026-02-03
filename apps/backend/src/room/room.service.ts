import { Injectable } from "@nestjs/common";
import { applyEvent, buildLobbyState } from "../game/fsm";
import type { ApplyResult, GameEvent, RoomState } from "../types";

function randomCode(len = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

@Injectable()
export class RoomService {
  private rooms = new Map<string, RoomState>(); // room code와 room을 매핑
  private socketToRoom = new Map<string, string>(); // socketId와 room을 매핑

  createRoom(hostSocketId: string, hostName: string, now = Date.now()): RoomState {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();

    const room = buildLobbyState(code, hostSocketId, hostName, now);
    this.rooms.set(code, room);
    this.socketToRoom.set(hostSocketId, code);
    return room;
  }

  getRoom(code: string): RoomState | undefined {
    return this.rooms.get(code);
  }

  getRoomBySocket(socketId: string): RoomState | undefined {
    const code = this.socketToRoom.get(socketId);
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  getRoomCodeBySocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  joinRoom(code: string, socketId: string, name: string, at = Date.now()) {
    return this.dispatch(code, { type: "PLAYER_JOIN", socketId, name, at });
  }

  leaveRoom(socketId: string, at = Date.now()): ApplyResult {
    const roomCode = this.getRoomCodeBySocket(socketId);
    if (!roomCode) return { ok: false, reason: "ROOM_NOT_FOUND", code: "NOT_FOUND" };
    return this.dispatch(roomCode, { type: "PLAYER_LEAVE", socketId, at });
  }

  setReady(socketId: string, isReady: boolean, at = Date.now()): ApplyResult {
    const roomCode = this.getRoomCodeBySocket(socketId);
    if (!roomCode) return { ok: false, reason: "ROOM_NOT_FOUND", code: "NOT_FOUND" };
    return this.dispatch(roomCode, { type: "READY_ON", socketId, at });
  }

  startGame(socketId: string, at = Date.now()): ApplyResult {
    const roomCode = this.getRoomCodeBySocket(socketId);
    if (!roomCode) return { ok: false, reason: "NOT_IN_ROOM", code: "NOT_FOUND" };
    return this.dispatch(roomCode, { type: "START_GAME", socketId, at });
  }

  dispatch(roomCode: string, event: GameEvent): ApplyResult {
    const room = this.rooms.get(roomCode);
    if (!room) return { ok: false, reason: "ROOM_NOT_FOUND", code: "NOT_FOUND" };

    const prevIds = new Set(room.players.map((p) => p.socketId));

    const result = applyEvent(room, event);
    if (!result.ok) return result;

    this.rooms.set(roomCode, result.room);
    this.reindexSocketsByPrevIds(prevIds, result.room);

    if (result.room.players.length === 0) this.rooms.delete(roomCode);
    return result;
  }

  private reindexSocketsByPrevIds(prevIds: Set<string>, next: RoomState) {
    const nextIds = new Set(next.players.map((p) => p.socketId));

    for (const id of prevIds) {
      if (!nextIds.has(id)) this.socketToRoom.delete(id);
    }
    for (const id of nextIds) {
      this.socketToRoom.set(id, next.roomCode);
    }
  }
}

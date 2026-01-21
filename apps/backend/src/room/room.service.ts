import { Injectable } from "@nestjs/common";
import type { RoomState } from "../types";

function randomCode(len = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

@Injectable()
export class RoomService {
  // roomCode -> roomState
  private rooms = new Map<string, RoomState>();
  // socketId -> roomCode (so we can clean up quickly)
  private socketToRoom = new Map<string, string>();

  createRoom(hostSocketId: string, hostName: string): RoomState {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();

    const now = Date.now();
    const room: RoomState = {
      roomCode: code,
      phase: "LOBBY",
      hostSocketId,
      createdAt: now,
      players: [
        {
          socketId: hostSocketId,
          name: hostName,
          isReady: false,
          joinedAt: now,
        },
      ],
    };

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

  joinRoom(code: string, socketId: string, name: string): RoomState | undefined {
    const room = this.rooms.get(code);
    if (!room) return undefined;

    // Disallow joining non-lobby rooms for this prototype
    if (room.phase !== "LOBBY") return undefined;

    const already = room.players.find((p) => p.socketId === socketId);
    if (already) return room;

    room.players.push({
      socketId,
      name,
      isReady: false,
      joinedAt: Date.now(),
    });

    this.socketToRoom.set(socketId, code);
    return room;
  }

  leaveRoom(socketId: string): { room?: RoomState; removed?: boolean } {
    const code = this.socketToRoom.get(socketId);
    if (!code) return { removed: false };

    const room = this.rooms.get(code);
    if (!room) {
      this.socketToRoom.delete(socketId);
      return { removed: false };
    }

    const before = room.players.length;
    room.players = room.players.filter((p) => p.socketId !== socketId);
    this.socketToRoom.delete(socketId);

    // Host transfer (simple): next player becomes host
    if (room.hostSocketId === socketId) {
      room.hostSocketId = room.players[0]?.socketId ?? "";
    }

    // If empty, destroy room
    if (room.players.length === 0) {
      this.rooms.delete(code);
      return { removed: true };
    }

    return { room, removed: before !== room.players.length };
  }

  setReady(socketId: string, isReady: boolean): RoomState | undefined {
    const room = this.getRoomBySocket(socketId);
    if (!room) return undefined;
    const p = room.players.find((x) => x.socketId === socketId);
    if (!p) return undefined;
    p.isReady = isReady;
    return room;
  }

  canStart(room: RoomState): boolean {
    if (room.phase !== "LOBBY") return false;
    if (room.players.length < 2) return false;
    return room.players.every((p) => p.isReady || p.socketId === room.hostSocketId); // host doesn’t have to ready (optional)
  }

  start(room: RoomState): RoomState {
    room.phase = "IN_GAME";
    return room;
  }
}

import type { Server } from "socket.io";
import { toPrivateState, toPublicState } from "./fsm";
import type { GameAction, RoomState, TimeoutKind } from "../types";
import { RoomService } from "../room/room.service";

export class ActionRunner {
  private timers = new Map<string, Map<TimeoutKind, NodeJS.Timeout>>();

  constructor(
    private readonly rooms: RoomService,
    private readonly server: Server,
  ) {}

  run(room: RoomState, actions: GameAction[]) {
    for (const action of actions) {
      switch (action.type) {
        case "BROADCAST_PUBLIC_STATE":
          this.server.to(room.roomCode).emit("room:state", toPublicState(room));
          break;
        case "EMIT_PRIVATE_STATE":
          this.server.to(action.socketId).emit("room:private", toPrivateState(room, action.socketId));
          break;
        case "SCHEDULE_TIMEOUT":
          this.schedule(room.roomCode, action.kind, action.ms);
          break;
        case "CANCEL_TIMEOUT":
          this.cancel(room.roomCode, action.kind);
          break;
        case "PERSIST_MATCH_RESULT":
          // Placeholder for persistence later.
          break;
        default:
          break;
      }
    }
  }

  clearAll(roomCode: string) {
    const timers = this.timers.get(roomCode);
    if (!timers) return;
    timers.forEach((handle) => clearTimeout(handle));
    this.timers.delete(roomCode);
  }

  private schedule(roomCode: string, kind: TimeoutKind, ms: number) {
    this.cancel(roomCode, kind);
    const timer = setTimeout(() => {
      const result = this.rooms.dispatch(roomCode, { type: "TIMEOUT", kind, at: Date.now() });
      if (result.ok) {
        this.run(result.room, result.actions);
      }
    }, ms);

    const roomTimers = this.timers.get(roomCode) ?? new Map<TimeoutKind, NodeJS.Timeout>();
    roomTimers.set(kind, timer);
    this.timers.set(roomCode, roomTimers);
  }

  private cancel(roomCode: string, kind: TimeoutKind) {
    const timers = this.timers.get(roomCode);
    if (!timers) return;
    const handle = timers.get(kind);
    if (handle) clearTimeout(handle);
    timers.delete(kind);
    if (timers.size === 0) this.timers.delete(roomCode);
  }
}

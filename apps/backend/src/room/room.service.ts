import { Injectable } from "@nestjs/common";
import { applyEvent, buildLobbyState } from "../game/fsm";
import type { ApplyResult, GameEvent, RoomState } from "../types";

/**
 * 사람이 읽기 쉬운 4자리 방 코드를 생성한다.
 * 혼동되기 쉬운 문자(I, O, 1, 0 등)는 제외한다.
 */
function randomCode(len = 4) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

@Injectable()
/**
 * 메모리 기반 방 상태 저장소.
 * 방 조회/생성 및 이벤트 디스패치를 통해 FSM 상태 변경을 적용한다.
 */
export class RoomService {
  /** 방 코드와 방 상태를 매핑한다. */
  private rooms = new Map<string, RoomState>();
  /** 소켓 ID와 방 코드를 매핑한다. */
  private socketToRoom = new Map<string, string>();

  /** 호스트를 포함한 새 로비 방을 생성하고 인덱스를 등록한다. */
  createRoom(hostSocketId: string, hostName: string, now = Date.now()): RoomState {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();

    const room = buildLobbyState(code, hostSocketId, hostName, now);
    this.rooms.set(code, room);
    this.socketToRoom.set(hostSocketId, code);
    return room;
  }

  /** 방 코드로 현재 방 상태를 조회한다. */
  getRoom(code: string): RoomState | undefined {
    return this.rooms.get(code);
  }

  /** 소켓 ID로 해당 소켓이 속한 방 상태를 조회한다. */
  getRoomBySocket(socketId: string): RoomState | undefined {
    const code = this.socketToRoom.get(socketId);
    if (!code) return undefined;
    return this.rooms.get(code);
  }

  /** 소켓 ID로 방 코드만 조회한다. */
  getRoomCodeBySocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  /** PLAYER_JOIN 이벤트를 편의 메서드로 디스패치한다. */
  joinRoom(code: string, socketId: string, name: string, at = Date.now()) {
    return this.dispatch(code, { type: "PLAYER_JOIN", socketId, name, at });
  }

  /** 소켓이 속한 방을 찾아 PLAYER_LEAVE 이벤트를 디스패치한다. */
  leaveRoom(socketId: string, at = Date.now()): ApplyResult {
    const roomCode = this.getRoomCodeBySocket(socketId);
    if (!roomCode) return { ok: false, reason: "ROOM_NOT_FOUND", code: "NOT_FOUND" };
    return this.dispatch(roomCode, { type: "PLAYER_LEAVE", socketId, at });
  }

  /** 소켓의 준비 상태를 변경하는 이벤트를 디스패치한다. */
  setReady(socketId: string, isReady: boolean, at = Date.now()): ApplyResult {
    const roomCode = this.getRoomCodeBySocket(socketId);
    if (!roomCode) return { ok: false, reason: "ROOM_NOT_FOUND", code: "NOT_FOUND" };
    return this.dispatch(roomCode, { type: isReady ? "READY_ON" : "READY_OFF", socketId, at });
  }

  /** 소켓이 속한 방에서 게임 시작 이벤트를 디스패치한다. */
  startGame(socketId: string, at = Date.now()): ApplyResult {
    const roomCode = this.getRoomCodeBySocket(socketId);
    if (!roomCode) return { ok: false, reason: "NOT_IN_ROOM", code: "NOT_FOUND" };
    return this.dispatch(roomCode, { type: "START_GAME", socketId, at });
  }

  /**
   * 방 상태에 게임 이벤트를 적용한다.
   * 성공 시 FSM 결과를 저장하고 소켓-방 인덱스를 최신 상태로 재구성한다.
   */
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

  /**
   * 이벤트 적용 전/후 플레이어 소켓 목록을 비교해 소켓-방 인덱스를 갱신한다.
   * 퇴장한 소켓 매핑은 제거하고, 남아 있는 소켓은 현재 방 코드로 재등록한다.
   */
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

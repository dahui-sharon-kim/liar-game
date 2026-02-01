import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { RoomService } from "../room/room.service";
import type { Ack, ApplyResult, PublicRoomSnapshot } from "../types";
import { fail, ok } from "../types";
import { toPublicState, toPrivateState } from "../game/fsm";

type CreateRoomDto = { name: string };
type JoinRoomDto = { roomCode: string; name: string };
type ReadyDto = { isReady: boolean };
type StartDto = {}; // keep empty for now

@WebSocketGateway({
  namespace: "/game",
  cors: { origin: true, credentials: true },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly rooms: RoomService) {}

  handleConnection(client: Socket) {
    client.emit("server:hello", { socketId: client.id, ts: Date.now() });
  }

  handleDisconnect(client: Socket) {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return;

    const result = this.rooms.dispatch(roomCode, {
      type: "DISCONNECT",
      socketId: client.id,
      at: Date.now(),
    });

    this.applySideEffects(roomCode, result);
  }

  private broadcastRoomState(roomCode: string, snapshot: PublicRoomSnapshot) {
    this.server.to(roomCode).emit("room:state", snapshot);
  }

  private applySideEffects(roomCode: string, result: ApplyResult) {
    if (!result.ok) return;

    // Broadcast public snapshot to the whole room.
    this.broadcastRoomState(roomCode, toPublicState(result.room));

    // Emit per-socket private snapshot (role) to each player, if you want to keep them updated.
    // For MVP, this is optional; you can emit private only on DEAL_ROLE.
    for (const p of result.room.players) {
      this.server.to(p.socketId).emit("room:private", toPrivateState(result.room, p.socketId));
    }

    // TODO: handle timers here when you implement an action runner:
    // - SCHEDULE_TIMEOUT / CANCEL_TIMEOUT
    // - Persist match results, etc.
  }

  @SubscribeMessage("room:create")
  onCreateRoom(
    @MessageBody() body: CreateRoomDto,
    @ConnectedSocket() client: Socket,
  ): Ack<{ roomCode: string; room: PublicRoomSnapshot }> {
    const name = (body?.name ?? "").trim();
    if (!name) return fail("BAD_REQUEST", "name is required");

    const room = this.rooms.createRoom(client.id, name);

    client.join(room.roomCode);

    // Broadcast public
    const publicSnap = toPublicState(room);
    this.broadcastRoomState(room.roomCode, publicSnap);

    // Emit private to creator
    client.emit("room:private", toPrivateState(room, client.id));

    return ok({ roomCode: room.roomCode, room: publicSnap });
  }

  @SubscribeMessage("room:join")
  onJoinRoom(@MessageBody() body: JoinRoomDto, @ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = (body?.roomCode ?? "").trim().toUpperCase();
    const name = (body?.name ?? "").trim();
    if (!roomCode) return fail("BAD_REQUEST", "roomCode is required");
    if (!name) return fail("BAD_REQUEST", "name is required");

    // Join socket.io room first so they receive broadcasts immediately after dispatch.
    client.join(roomCode);

    const result = this.rooms.dispatch(roomCode, {
      type: "PLAYER_JOIN",
      socketId: client.id,
      name,
      at: Date.now(),
    });

    if (!result.ok) {
      // Roll back socket.io join if domain join failed
      client.leave(roomCode);
      return fail(result.code ?? "BAD_REQUEST", result.reason);
    }

    this.applySideEffects(roomCode, result);

    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:leave")
  onLeave(@ConnectedSocket() client: Socket): Ack<{ left: true }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return ok({ left: true });

    const result = this.rooms.dispatch(roomCode, {
      type: "PLAYER_LEAVE",
      socketId: client.id,
      at: Date.now(),
    });

    // Leave all joined socket.io rooms except its own internal room.
    for (const r of client.rooms) {
      if (r !== client.id) client.leave(r);
    }

    this.applySideEffects(roomCode, result);

    return ok({ left: true });
  }

  @SubscribeMessage("room:ready")
  onReady(@MessageBody() body: ReadyDto, @ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const result = this.rooms.dispatch(roomCode, {
      type: body?.isReady ? "READY_ON" : "READY_OFF",
      socketId: client.id,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(roomCode, result);

    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:start")
  onStart(@MessageBody() _body: StartDto, @ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const result = this.rooms.dispatch(roomCode, {
      type: "START_GAME",
      socketId: client.id,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(roomCode, result);

    return ok({ room: toPublicState(result.room) });
  }
}

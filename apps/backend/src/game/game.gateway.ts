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
import type { Ack, RoomState } from "../types";
import { fail, ok } from "../types";

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
    // You can add auth here (cookies/JWT) later.
    client.emit("server:hello", { socketId: client.id, ts: Date.now() });
  }

  handleDisconnect(client: Socket) {
    const { room } = this.rooms.leaveRoom(client.id);
    if (room) this.broadcastRoomState(room);
  }

  private broadcastRoomState(room: RoomState) {
    this.server.to(room.roomCode).emit("room:state", room);
  }

  @SubscribeMessage("room:create")
  onCreateRoom(
    @MessageBody() body: CreateRoomDto,
    @ConnectedSocket() client: Socket,
  ): Ack<{ roomCode: string; room: RoomState }> {
    const name = (body?.name ?? "").trim();
    if (!name) return fail("BAD_REQUEST", "name is required");

    const room = this.rooms.createRoom(client.id, name);

    // Join socket.io room
    client.join(room.roomCode);

    // Notify caller and broadcast state (caller included)
    this.broadcastRoomState(room);
    return ok({ roomCode: room.roomCode, room });
  }

  @SubscribeMessage("room:join")
  onJoinRoom(@MessageBody() body: JoinRoomDto, @ConnectedSocket() client: Socket): Ack<{ room: RoomState }> {
    const roomCode = (body?.roomCode ?? "").trim().toUpperCase();
    const name = (body?.name ?? "").trim();
    if (!roomCode) return fail("BAD_REQUEST", "roomCode is required");
    if (!name) return fail("BAD_REQUEST", "name is required");

    const room = this.rooms.joinRoom(roomCode, client.id, name);
    if (!room) return fail("NOT_FOUND", "room not found or not joinable");

    client.join(room.roomCode);
    this.broadcastRoomState(room);
    return ok({ room });
  }

  @SubscribeMessage("room:leave")
  onLeave(@ConnectedSocket() client: Socket): Ack<{ left: true }> {
    const { room, removed } = this.rooms.leaveRoom(client.id);
    client.rooms.forEach((r) => {
      // socket.io auto-includes its own id as a room; ignore it
      if (r !== client.id) client.leave(r);
    });

    if (room && !removed) this.broadcastRoomState(room);
    return ok({ left: true });
  }

  @SubscribeMessage("room:ready")
  onReady(@MessageBody() body: ReadyDto, @ConnectedSocket() client: Socket): Ack<{ room: RoomState }> {
    const room = this.rooms.setReady(client.id, !!body?.isReady);
    if (!room) return fail("NOT_FOUND", "not in a room");
    this.broadcastRoomState(room);
    return ok({ room });
  }

  @SubscribeMessage("room:start")
  onStart(@MessageBody() _body: StartDto, @ConnectedSocket() client: Socket): Ack<{ room: RoomState }> {
    const room = this.rooms.getRoomBySocket(client.id);
    if (!room) return fail("NOT_FOUND", "not in a room");
    if (room.hostSocketId !== client.id) return fail("FORBIDDEN", "only host can start");
    if (!this.rooms.canStart(room)) return fail("PRECONDITION_FAILED", "not everyone is ready");

    this.rooms.start(room);
    this.broadcastRoomState(room);
    return ok({ room });
  }
}

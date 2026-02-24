import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from "@nestjs/websockets";
import { randomBytes } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { RoomService } from "../room/room.service";
import { ActionRunner } from "./action-runner";
import type { Ack, ApplyResult, PublicRoomSnapshot } from "../types";
import { fail, ok } from "../types";
import { toPublicState, toPrivateState } from "../game/fsm";

type CreateRoomDto = { name: string };
type JoinRoomDto = { roomCode: string; name: string };
type ReadyDto = { isReady: boolean };
type StartDto = {}; // keep empty for now
type SubmitActionDto = { action: unknown };
type SubmitVoteDto = { targetSocketId: string | null };
type ReconnectDto = { roomCode: string; previousSocketId: string; reconnectNonce: string };

// 클라이언트와 게임 도메인(FSM/RoomService) 사이를 연결하는 Socket.IO 게이트웨이
@WebSocketGateway({
  namespace: "/game",
  cors: { origin: true, credentials: true },
})
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private actionRunner?: ActionRunner;
  private reconnectNonces = new Map<string, string>();

  constructor(private readonly rooms: RoomService) {}

  // Socket.IO 서버가 준비되면 사이드이펙트 실행기(ActionRunner)를 연결
  afterInit(server: Server) {
    this.actionRunner = new ActionRunner(this.rooms, server);
  }

  // 새 클라이언트 연결 시 socketId, reconnectNonce, ts를 emit
  handleConnection(client: Socket) {
    client.emit("server:hello", {
      socketId: client.id,
      reconnectNonce: this.issueReconnectNonce(client.id), // 재연결 시에는 socketId와 함께 이 nonce(토큰 역할)를 제출해야 함
      ts: Date.now(),
    });
  }

  // 연결 종료 시, 해당 소켓이 속한 방이 있으면 DISCONNECT 이벤트를 도메인에 전달
  handleDisconnect(client: Socket) {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) {
      this.reconnectNonces.delete(client.id);
      return;
    }

    const result = this.rooms.dispatch(roomCode, {
      type: "DISCONNECT",
      socketId: client.id,
      at: Date.now(),
    });

    this.applySideEffects(result);
  }

  private issueReconnectNonce(socketId: string): string {
    const nonce = randomBytes(16).toString("hex");
    this.reconnectNonces.set(socketId, nonce);
    return nonce;
  }

  // 특정 방의 모든 클라이언트에게 공개 상태(room:state)를 브로드캐스트
  private broadcastRoomState(roomCode: string, snapshot: PublicRoomSnapshot) {
    this.server.to(roomCode).emit("room:state", snapshot);
  }

  // FSM 결과에 포함된 사이드이펙트 액션(emit/timeout 등록/취소)을 실행
  private applySideEffects(result: ApplyResult) {
    if (!result.ok) return;
    const runner = this.actionRunner ?? (this.actionRunner = new ActionRunner(this.rooms, this.server));
    runner.run(result.room, result.actions);
  }

  @SubscribeMessage("room:create")
  // 방을 생성하고, 요청 소켓을 Socket.IO room에 참여시킨 뒤 공개/개인 상태를 전송
  onCreateRoom(
    @MessageBody() body: CreateRoomDto,
    @ConnectedSocket() client: Socket,
  ): Ack<{ roomCode: string; room: PublicRoomSnapshot }> {
    const name = (body?.name ?? "").trim();
    if (!name) return fail("BAD_REQUEST", "name is required");
    if (this.rooms.getRoomBySocket(client.id)) return fail("BAD_REQUEST", "already in a room");

    const room = this.rooms.createRoom(client.id, name);
    client.join(room.roomCode);

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
      // 도메인 입장 실패 시 Socket.IO room 참여를 되돌린다.
      client.leave(roomCode);
      return fail(result.code ?? "BAD_REQUEST", result.reason);
    }

    this.applySideEffects(result);

    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:leave")
  // 현재 소켓을 게임 방에서 퇴장시키고, 참여 중인 Socket.IO room에서도 제거
  onLeave(@ConnectedSocket() client: Socket): Ack<{ left: true }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return ok({ left: true });

    const result = this.rooms.dispatch(roomCode, {
      type: "PLAYER_LEAVE",
      socketId: client.id,
      at: Date.now(),
    });

    // 자기 자신 전용 room(client.id)은 유지하고, 나머지 Socket.IO room만 나간다.
    for (const r of client.rooms) {
      if (r !== client.id) client.leave(r);
    }

    this.applySideEffects(result);
    this.reconnectNonces.delete(client.id);

    return ok({ left: true });
  }

  @SubscribeMessage("room:ready")
  // 로비에서 플레이어 준비 상태를 켜거나 끈다.
  onReady(@MessageBody() body: ReadyDto, @ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const result = this.rooms.dispatch(roomCode, {
      type: body?.isReady ? "READY_ON" : "READY_OFF",
      socketId: client.id,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(result);

    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:start")
  // 호스트가 게임 시작을 요청한다(인원/준비 상태 검사는 FSM에서 수행).
  onStart(@MessageBody() _body: StartDto, @ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const result = this.rooms.dispatch(roomCode, {
      type: "START_GAME",
      socketId: client.id,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(result);

    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:action")
  // 토론 단계에서 행동/채팅 입력을 받는다(MVP에서는 상태 변화 없이 수신만 허용).
  onSubmitAction(
    @MessageBody() body: SubmitActionDto,
    @ConnectedSocket() client: Socket,
  ): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const result = this.rooms.dispatch(roomCode, {
      type: "SUBMIT_ACTION",
      socketId: client.id,
      action: body?.action,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(result);
    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:vote")
  // 현재 라운드 투표를 제출
  onVote(@MessageBody() body: SubmitVoteDto, @ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const targetSocketId =
      body?.targetSocketId === null || body?.targetSocketId === undefined ? null : String(body.targetSocketId);

    const result = this.rooms.dispatch(roomCode, {
      type: "SUBMIT_VOTE",
      socketId: client.id,
      targetSocketId,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(result);
    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:vote:cancel")
  // 제출한 투표를 취소(미선택 상태로 되돌림)
  onCancelVote(@ConnectedSocket() client: Socket): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = this.rooms.getRoomCodeBySocket(client.id);
    if (!roomCode) return fail("NOT_FOUND", "not in a room");

    const result = this.rooms.dispatch(roomCode, {
      type: "CANCEL_VOTE",
      socketId: client.id,
      at: Date.now(),
    });

    if (!result.ok) return fail(result.code ?? "BAD_REQUEST", result.reason);

    this.applySideEffects(result);
    return ok({ room: toPublicState(result.room) });
  }

  @SubscribeMessage("room:reconnect")
  // 재접속한 소켓을 이전 socketId 플레이어로 복구
  onReconnectRoom(
    @MessageBody() body: ReconnectDto,
    @ConnectedSocket() client: Socket,
  ): Ack<{ room: PublicRoomSnapshot }> {
    const roomCode = (body?.roomCode ?? "").trim().toUpperCase();
    const previousSocketId = (body?.previousSocketId ?? "").trim();
    const reconnectNonce = (body?.reconnectNonce ?? "").trim();
    if (!roomCode) return fail("BAD_REQUEST", "roomCode is required");
    if (!previousSocketId) return fail("BAD_REQUEST", "previousSocketId is required");
    if (!reconnectNonce) return fail("BAD_REQUEST", "reconnectNonce is required");
    if (this.reconnectNonces.get(previousSocketId) !== reconnectNonce) {
      return fail("UNAUTHORIZED", "invalid reconnect token");
    }

    client.join(roomCode);

    const result = this.rooms.dispatch(roomCode, {
      type: "RECONNECT",
      socketId: previousSocketId,
      newSocketId: client.id,
      at: Date.now(),
    });

    if (!result.ok) {
      client.leave(roomCode);
      return fail(result.code ?? "BAD_REQUEST", result.reason);
    }

    this.reconnectNonces.delete(previousSocketId);
    client.emit("server:hello", {
      socketId: client.id,
      reconnectNonce: this.issueReconnectNonce(client.id),
      ts: Date.now(),
    });
    this.applySideEffects(result);
    return ok({ room: toPublicState(result.room) });
  }
}

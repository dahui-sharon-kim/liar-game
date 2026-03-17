"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { clearRoomSession, readSession, writeSession } from "@/lib/access-sessions";
import { getErrorMessage } from "@/lib/get-error-message";
import { createGameSocket, emitAck } from "@/lib/game-socket";
import type { PrivateRoomSnapshot, PublicPlayerState, PublicRoomSnapshot, ServerHello } from "@/lib/game-types";

type GameContextValue = {
  name: string;
  setName: React.Dispatch<React.SetStateAction<string>>;
  joinCode: string;
  setJoinCode: React.Dispatch<React.SetStateAction<string>>;
  room: PublicRoomSnapshot | null;
  privateRoom: PrivateRoomSnapshot | null;
  hello: ServerHello | null;
  error: string | null;
  pendingAction: string | null;
  connectionLabel: string;
  phaseMeta: {
    title: string;
    description: string;
    countdownLabel: string;
  };
  selfSocketId: string | null;
  selfPlayer: PublicPlayerState | null;
  isHost: boolean;
  alivePlayers: PublicPlayerState[];
  voteSubmissionOpen: boolean;
  selfVoteSubmitted: boolean;
  now: number;
  createRoom: () => Promise<void>;
  joinRoom: () => Promise<void>;
  toggleReady: () => Promise<void>;
  startGame: () => Promise<void>;
  vote: (targetSocketId: string | null) => Promise<void>;
  cancelVote: () => Promise<void>;
  leaveRoom: () => Promise<void>;
  copyRoomCode: () => Promise<void>;
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<PublicRoomSnapshot | null>(null);
  const [privateRoom, setPrivateRoom] = useState<PrivateRoomSnapshot | null>(null);
  const [hello, setHello] = useState<ServerHello | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [connectionLabel, setConnectionLabel] = useState("Connecting");
  const [now, setNow] = useState(() => Date.now());
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = readSession();
    if (stored.name) setName(stored.name);
    if (stored.roomCode) setJoinCode(stored.roomCode);

    const socket = createGameSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnectionLabel("Connected");
      setError(null);
    });

    socket.on("disconnect", () => {
      setConnectionLabel("Disconnected");
    });

    socket.on("connect_error", (connectError) => {
      setConnectionLabel("Connection failed");
      setError(connectError.message || "Backend connection failed");
    });

    socket.on("server:hello", (payload: ServerHello) => {
      setHello(payload);
      writeSession((prev) => ({
        ...prev,
        name: prev.name || stored.name || "",
        previousSocketId: payload.socketId,
        reconnectNonce: payload.reconnectNonce,
      }));
    });

    socket.on("room:state", (snapshot: PublicRoomSnapshot) => {
      setRoom(snapshot);
      writeSession((prev) => ({ ...prev, roomCode: snapshot.roomCode }));
    });

    socket.on("room:private", (snapshot: PrivateRoomSnapshot) => {
      setPrivateRoom(snapshot);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    const stored = readSession();
    if (!socket || !hello || !stored.roomCode || !stored.previousSocketId || !stored.reconnectNonce) return;
    if (hello.socketId === stored.previousSocketId) return;

    const attemptKey = `${stored.roomCode}:${stored.previousSocketId}:${hello.socketId}`;
    if (reconnectAttemptRef.current === attemptKey) return;
    reconnectAttemptRef.current = attemptKey;

    const roomCode = stored.roomCode;
    const previousSocketId = stored.previousSocketId;
    const reconnectNonce = stored.reconnectNonce;

    void (async () => {
      try {
        const response = await emitAck<
          { room: PublicRoomSnapshot },
          { roomCode: string; previousSocketId: string; reconnectNonce: string }
        >(socket, "room:reconnect", {
          roomCode,
          previousSocketId,
          reconnectNonce,
        });

        if (!response.ok) {
          clearRoomSession();
          setRoom(null);
          setPrivateRoom(null);
          setError(`재접속 실패: ${response.error.message}`);
          return;
        }

        setRoom(response.data.room);
        setJoinCode(response.data.room.roomCode);
        setError(null);
      } catch (reconnectError) {
        clearRoomSession();
        setRoom(null);
        setPrivateRoom(null);
        setError(getErrorMessage(reconnectError, "재접속 중 오류가 발생했습니다."));
      }
    })();
  }, [hello]);

  const selfSocketId = privateRoom?.self?.socketId ?? hello?.socketId ?? null;
  const selfPlayer = room?.players.find((player) => player.socketId === selfSocketId) ?? null;
  const isHost = Boolean(room && selfSocketId && room.hostSocketId === selfSocketId);
  const alivePlayers = useMemo(() => room?.players.filter((player) => player.alive) ?? [], [room]);
  const voteSubmissionOpen = room?.kind === "VOTE_OPEN";
  const selfVoteSubmitted =
    room?.kind === "VOTE_OPEN" || room?.kind === "VOTE_RESOLVE"
      ? Boolean(selfSocketId && room.votes[selfSocketId] === "__SUBMITTED__")
      : false;

  const phaseMeta = useMemo(() => getPhaseMeta(room, now), [room, now]);

  const runAction = useCallback(async (actionLabel: string, runner: (socket: Socket) => Promise<void>) => {
    const socket = socketRef.current;
    if (!socket) {
      setError("소켓 연결이 아직 준비되지 않았습니다.");
      return;
    }

    setPendingAction(actionLabel);
    setError(null);

    try {
      await runner(socket);
    } catch (actionError) {
      setError(getErrorMessage(actionError, "요청을 처리하지 못했습니다."));
    } finally {
      setPendingAction(null);
    }
  }, []);

  const persistIdentity = useCallback((nextName: string) => {
    writeSession((prev) => ({ ...prev, name: nextName.trim() }));
  }, []);

  const createRoom = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("플레이어 이름을 입력하세요.");
      return;
    }

    persistIdentity(trimmedName);

    await runAction("create", async (socket) => {
      const response = await emitAck<{ roomCode: string; room: PublicRoomSnapshot }, { name: string }>(
        socket,
        "room:create",
        {
          name: trimmedName,
        },
      );

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setRoom(response.data.room);
      setPrivateRoom(null);
      setJoinCode(response.data.roomCode);
      writeSession((prev) => ({
        ...prev,
        name: trimmedName,
        roomCode: response.data.roomCode,
        previousSocketId: hello?.socketId ?? prev.previousSocketId,
        reconnectNonce: hello?.reconnectNonce ?? prev.reconnectNonce,
      }));
    });
  }, [hello?.reconnectNonce, hello?.socketId, name, runAction, persistIdentity]);

  const joinRoom = useCallback(async () => {
    const trimmedName = name.trim();
    const roomCode = joinCode.trim().toUpperCase();
    if (!trimmedName) {
      setError("플레이어 이름을 입력하세요.");
      return;
    }
    if (!roomCode) {
      setError("참여할 방 코드를 입력하세요.");
      return;
    }

    persistIdentity(trimmedName);

    await runAction("join", async (socket) => {
      const response = await emitAck<{ room: PublicRoomSnapshot }, { roomCode: string; name: string }>(
        socket,
        "room:join",
        {
          roomCode,
          name: trimmedName,
        },
      );

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setRoom(response.data.room);
      setPrivateRoom(null);
      setJoinCode(roomCode);
      writeSession((prev) => ({
        ...prev,
        name: trimmedName,
        roomCode,
        previousSocketId: hello?.socketId ?? prev.previousSocketId,
        reconnectNonce: hello?.reconnectNonce ?? prev.reconnectNonce,
      }));
    });
  }, [hello?.reconnectNonce, hello?.socketId, joinCode, name, persistIdentity, runAction]);

  const toggleReady = useCallback(async () => {
    if (!room || !selfPlayer) return;

    await runAction("ready", async (socket) => {
      const response = await emitAck<{ room: PublicRoomSnapshot }, { isReady: boolean }>(socket, "room:ready", {
        isReady: !selfPlayer.isReady,
      });

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setRoom(response.data.room);
    });
  }, [room, runAction, selfPlayer]);

  const startGame = useCallback(async () => {
    await runAction("start", async (socket) => {
      const response = await emitAck<{ room: PublicRoomSnapshot }, Record<string, never>>(socket, "room:start", {});

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setRoom(response.data.room);
    });
  }, [runAction]);

  const vote = useCallback(
    async (targetSocketId: string | null) => {
      await runAction("vote", async (socket) => {
        const response = await emitAck<{ room: PublicRoomSnapshot }, { targetSocketId: string | null }>(
          socket,
          "room:vote",
          {
            targetSocketId,
          },
        );

        if (!response.ok) {
          setError(response.error.message);
          return;
        }

        setRoom(response.data.room);
      });
    },
    [runAction],
  );

  const cancelVote = useCallback(async () => {
    await runAction("cancel-vote", async (socket) => {
      const response = await emitAck<{ room: PublicRoomSnapshot }>(socket, "room:vote:cancel");

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      setRoom(response.data.room);
    });
  }, [runAction]);

  const leaveRoom = useCallback(async () => {
    await runAction("leave", async (socket) => {
      const response = await emitAck<{ left: true }>(socket, "room:leave");

      if (!response.ok) {
        setError(response.error.message);
        return;
      }

      clearRoomSession();
      setRoom(null);
      setPrivateRoom(null);
      setJoinCode("");
    });
  }, [runAction]);

  const copyRoomCode = useCallback(async () => {
    if (!room) return;

    try {
      await navigator.clipboard.writeText(room.roomCode);
    } catch {
      setError("방 코드를 복사하지 못했습니다.");
    }
  }, [room]);

  const value = useMemo<GameContextValue>(
    () => ({
      name,
      setName,
      joinCode,
      setJoinCode,
      room,
      privateRoom,
      hello,
      error,
      pendingAction,
      connectionLabel,
      phaseMeta,
      selfSocketId,
      selfPlayer,
      isHost,
      alivePlayers,
      voteSubmissionOpen,
      selfVoteSubmitted,
      now,
      createRoom,
      joinRoom,
      toggleReady,
      startGame,
      vote,
      cancelVote,
      leaveRoom,
      copyRoomCode,
    }),
    [
      name,
      joinCode,
      room,
      privateRoom,
      hello,
      error,
      pendingAction,
      connectionLabel,
      phaseMeta,
      selfSocketId,
      selfPlayer,
      isHost,
      alivePlayers,
      voteSubmissionOpen,
      selfVoteSubmitted,
      now,
      createRoom,
      joinRoom,
      toggleReady,
      startGame,
      vote,
      cancelVote,
      leaveRoom,
      copyRoomCode,
    ],
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }

  return context;
}

function getPhaseMeta(room: PublicRoomSnapshot | null, now: number) {
  if (!room) {
    return {
      title: "No Room",
      description: "방에 입장하면 서버가 브로드캐스트하는 상태가 여기 표시됩니다.",
      countdownLabel: "--",
    };
  }

  switch (room.kind) {
    case "LOBBY":
      return {
        title: "Lobby",
        description: "참가자 준비를 기다리는 상태입니다.",
        countdownLabel: "--",
      };
    case "DEAL_ROLE":
      return {
        title: "Deal Role",
        description: "서버가 역할을 배정하고 private snapshot을 전송하는 중입니다.",
        countdownLabel: "1s",
      };
    case "DISCUSSION_ROUND":
      return {
        title: "Discussion",
        description: "토론 종료 후 서버가 자동으로 투표 단계로 이동합니다.",
        countdownLabel: formatCountdown(room.discussionEndsAt, now),
      };
    case "VOTE_OPEN":
      return {
        title: "Vote Open",
        description: "모든 생존자가 투표하거나 시간 종료 시 집계됩니다.",
        countdownLabel: formatCountdown(room.voteEndsAt, now),
      };
    case "VOTE_RESOLVE":
      return {
        title: "Vote Resolve",
        description: "집계 결과를 공개한 뒤 다음 라운드 또는 종료로 넘어갑니다.",
        countdownLabel: formatCountdown(room.resolveEndsAt, now),
      };
    case "END":
      return {
        title: "End",
        description: room.winner === "LIARS" ? "라이어 팀 승리" : "시민 팀 승리",
        countdownLabel: "done",
      };
    default:
      return {
        title: "Unknown",
        description: "",
        countdownLabel: "--",
      };
  }
}

function formatCountdown(targetTime: number | undefined, now: number) {
  if (!targetTime) return "--";
  const diff = Math.max(0, Math.ceil((targetTime - now) / 1_000));
  return `${diff}s`;
}

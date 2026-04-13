"use client";

import { io, type Socket } from "socket.io-client";
import type { Ack } from "@/lib/game-types";

const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:4000";

export function createGameSocket(): Socket {
  return io(`${GAME_SERVER_URL}/game`, {
    withCredentials: true,
    autoConnect: true,
  });
}

export function emitAck<TResponse, TPayload = undefined>(
  socket: Socket,
  event: string,
  payload?: TPayload,
): Promise<Ack<TResponse>> {
  return new Promise((resolve, reject) => {
    const callback = (error: Error | null, response?: Ack<TResponse>) => {
      if (error) {
        reject(error);
        return;
      }

      if (!response) {
        reject(new Error("No response from server"));
        return;
      }

      resolve(response);
    };

    if (payload === undefined) {
      socket.timeout(5_000).emit(event, callback);
      return;
    }

    socket.timeout(5_000).emit(event, payload, callback);
  });
}

export { GAME_SERVER_URL };

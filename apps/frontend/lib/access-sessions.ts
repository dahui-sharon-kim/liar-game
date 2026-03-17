import { SESSION_KEY } from "@/constants/constants";
import { StoredSession } from "@/types/types";

/**
 * localStorage에 세션 정보를 저장하는 유틸 함수
 * @param updater
 * @returns
 */
export function writeSession(updater: (prev: StoredSession) => StoredSession) {
  if (typeof window === "undefined") return;

  const next = updater(readSession());
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
}

export function readSession(): StoredSession {
  if (typeof window === "undefined") return { name: "" };

  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return { name: "" };
    return JSON.parse(raw) as StoredSession;
  } catch {
    return { name: "" };
  }
}

export function clearRoomSession() {
  writeSession((prev) => ({
    ...prev,
    roomCode: undefined,
    previousSocketId: undefined,
    reconnectNonce: undefined,
  }));
}

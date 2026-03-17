export type StoredSession = {
  name: string;
  roomCode?: string;
  previousSocketId?: string;
  reconnectNonce?: string;
};

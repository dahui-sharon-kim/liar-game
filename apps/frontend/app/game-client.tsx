"use client";

import { AlertCircleIcon } from "lucide-react";
import { GameProvider, useGame } from "@/app/game-context";
import { JoinOrCreate } from "@/app/entry/join-or-create";
import { RoomDashboard } from "@/app/room/room-dashboard";

export default function GameClient() {
  return (
    <GameProvider>
      <GameScreen />
    </GameProvider>
  );
}

function GameScreen() {
  const { room, error } = useGame();

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-7xl flex-col justify-center gap-6 px-4 py-6 sm:px-6 lg:px-8">
        {!room ? (
          <section className="mx-auto w-full max-w-xl">
            {error ? (
              <div className="mb-4 flex items-center gap-2 border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                <AlertCircleIcon className="size-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            <JoinOrCreate />
          </section>
        ) : (
          <RoomDashboard />
        )}
      </div>
    </main>
  );
}

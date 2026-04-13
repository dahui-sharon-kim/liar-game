import { createFileRoute } from "@tanstack/react-router";
import GameClient from "@/app/game-client";

export const Route = createFileRoute("/")({
  component: GameClient,
});

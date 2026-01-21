import { Module } from "@nestjs/common";
import { GameGateway } from "./game/game.gateway";
import { RoomService } from "./room/room.service";

@Module({
  imports: [],
  controllers: [],
  providers: [GameGateway, RoomService],
})
export class AppModule {}

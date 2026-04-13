import {
  AlertCircleIcon,
  CheckIcon,
  CopyIcon,
  DoorOpenIcon,
  LoaderCircleIcon,
  PlayIcon,
  RadioIcon,
  ShieldAlertIcon,
  UsersIcon,
} from "lucide-react";
import { useGame } from "@/app/game-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PublicPlayerState } from "@/lib/game-types";

export function RoomDashboard() {
  const {
    room,
    privateRoom,
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
    toggleReady,
    startGame,
    vote,
    cancelVote,
    leaveRoom,
    copyRoomCode,
  } = useGame();

  if (!room) return null;

  return (
    <>
      <section className="grid gap-4 border border-white/10 bg-black/25 p-5 backdrop-blur-sm lg:grid-cols-[1.25fr_0.75fr]">
        <div className="space-y-4">
          <Badge className="border border-emerald-300/30 bg-emerald-300/10 text-emerald-100" variant="outline">
            Real-time liar room
          </Badge>
          <div className="space-y-2">
            <h1 className="font-[family:var(--font-pretendard)] text-3xl font-semibold tracking-[-0.04em] sm:text-5xl">
              Liar Game Online
            </h1>
            <p className="max-w-2xl text-sm text-white/72 sm:text-base">입장 이후 필요한 패널만 분리해서 렌더링합니다.</p>
          </div>
        </div>
        <div className="grid gap-3 border border-white/10 bg-white/5 p-4 text-sm">
          <StatusRow icon={<RadioIcon className="size-4" />} label="연결 상태" value={connectionLabel} />
          <StatusRow icon={<UsersIcon className="size-4" />} label="Room" value={room.roomCode} />
          <StatusRow
            icon={<ShieldAlertIcon className="size-4" />}
            label="Role"
            value={privateRoom?.self?.role ? roleLabel(privateRoom.self.role) : "Hidden"}
          />
        </div>
      </section>

      {error ? (
        <div className="flex items-center gap-2 border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
        <Card className="border-white/10 bg-black/30 text-white">
          <CardHeader>
            <CardTitle>현재 방</CardTitle>
            <CardDescription className="text-white/60">{phaseMeta.title} 상태를 서버 스냅샷으로 렌더링합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Round" value={String(room.round)} />
              <MetricCard label="Players" value={`${room.players.length}`} />
              <MetricCard label="Time Left" value={phaseMeta.countdownLabel} />
            </div>

            <div className="flex flex-wrap items-center gap-2 border border-white/10 bg-white/5 p-3 text-xs text-white/70">
              <Badge className="border-white/10 bg-white/10 text-white" variant="outline">
                {room.roomCode}
              </Badge>
              <span>{phaseMeta.description}</span>
              <Button
                onClick={copyRoomCode}
                variant="ghost"
                size="icon-xs"
                className="ml-auto border border-white/10 text-white hover:bg-white/10"
              >
                <CopyIcon />
              </Button>
            </div>

            {room.kind === "LOBBY" ? (
              <LobbyControls
                isHost={isHost}
                selfReady={Boolean(selfPlayer?.isReady)}
                everyoneReady={room.players.every((player) => player.isReady || player.socketId === room.hostSocketId)}
                playerCount={room.players.length}
                pendingAction={pendingAction}
                onReadyToggle={toggleReady}
                onStart={startGame}
              />
            ) : null}

            {room.kind === "DEAL_ROLE" || room.kind === "DISCUSSION_ROUND" ? (
              <div className="grid gap-3 border border-emerald-300/15 bg-emerald-300/8 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-emerald-100/60">Private Role</p>
                    <p className="mt-1 text-xl font-semibold">
                      {privateRoom?.self?.role ? roleLabel(privateRoom.self.role) : "역할 공개 대기 중"}
                    </p>
                  </div>
                  <Badge className="border-emerald-200/20 bg-emerald-200/10 text-emerald-50" variant="outline">
                    {phaseMeta.title}
                  </Badge>
                </div>
                <p className="text-sm text-emerald-50/75">토론/행동 패널은 이후 별도 컴포넌트로 확장하기 쉽게 분리해 두었습니다.</p>
              </div>
            ) : null}

            {room.kind === "VOTE_OPEN" ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/45">Vote</p>
                    <p className="text-sm text-white/70">살아 있는 플레이어 중 한 명을 선택하세요.</p>
                  </div>
                  <Badge className="border-white/10 bg-white/10 text-white" variant="outline">
                    {selfVoteSubmitted ? "제출됨" : "미제출"}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {alivePlayers.map((player) => (
                    <Button
                      key={player.socketId}
                      onClick={() => vote(player.socketId)}
                      disabled={!voteSubmissionOpen || pendingAction !== null || player.socketId === selfSocketId}
                      variant="outline"
                      className="justify-between border-white/10 bg-white/5 text-white hover:bg-white/10 disabled:opacity-40"
                    >
                      <span>{player.name}</span>
                      <span className="font-mono text-[10px] uppercase text-white/45">
                        {player.socketId === room.hostSocketId ? "host" : "player"}
                      </span>
                    </Button>
                  ))}
                </div>
                <Button
                  onClick={cancelVote}
                  disabled={pendingAction !== null || !selfVoteSubmitted}
                  variant="ghost"
                  className="border border-white/10 text-white hover:bg-white/10"
                >
                  투표 취소
                </Button>
              </div>
            ) : null}

            {room.kind === "VOTE_RESOLVE" ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-amber-200/20 bg-amber-200/10 text-amber-50" variant="outline">
                    결과 집계 중
                  </Badge>
                  <span className="text-sm text-white/70">
                    {room.eliminated ? `${playerNameById(room.players, room.eliminated)} 탈락` : "동률 또는 무효로 탈락자가 없습니다."}
                  </span>
                </div>
                <div className="grid gap-2">
                  {Object.entries(room.tally).length ? (
                    Object.entries(room.tally)
                      .sort((a, b) => b[1] - a[1])
                      .map(([socketId, voteCount]) => (
                        <div
                          key={socketId}
                          className="flex items-center justify-between border border-white/10 bg-white/5 px-3 py-2 text-sm"
                        >
                          <span>{playerNameById(room.players, socketId)}</span>
                          <span className="font-mono text-white/60">{voteCount} votes</span>
                        </div>
                      ))
                  ) : (
                    <div className="border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60">집계된 표가 없습니다.</div>
                  )}
                </div>
              </div>
            ) : null}

            {room.kind === "END" ? (
              <div className="grid gap-3 border border-sky-300/15 bg-sky-300/8 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-sky-50/60">Match Result</p>
                <div className="flex items-center gap-2">
                  <Badge className="border-sky-200/20 bg-sky-200/10 text-sky-50" variant="outline">
                    {room.winner === "LIARS" ? "LIARS WIN" : "CIVILIANS WIN"}
                  </Badge>
                  {room.eliminated ? (
                    <span className="text-sm text-sky-50/75">마지막 탈락: {playerNameById(room.players, room.eliminated)}</span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </CardContent>
          <CardFooter className="justify-between border-white/10">
            <div className="text-xs text-white/45">last event {formatRelative(room.lastEventAt, now)}</div>
            <Button
              onClick={leaveRoom}
              disabled={pendingAction !== null}
              variant="ghost"
              className="border border-white/10 text-white hover:bg-white/10"
            >
              <DoorOpenIcon />
              방 나가기
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-white/10 bg-black/30 text-white">
          <CardHeader>
            <CardTitle>플레이어</CardTitle>
            <CardDescription className="text-white/60">호스트, 준비 상태, 생존 여부를 한 번에 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {room.players.map((player) => (
              <PlayerRow
                key={player.socketId}
                player={player}
                isHost={player.socketId === room.hostSocketId}
                isSelf={player.socketId === selfSocketId}
              />
            ))}
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3 border-white/10">
            <div className="text-xs uppercase tracking-[0.18em] text-white/35">Phase Notes</div>
            <Separator className="bg-white/10" />
            <ul className="space-y-2 text-sm text-white/68">
              <li>로비에서는 호스트만 `start`를 호출할 수 있습니다.</li>
              <li>호스트 외 플레이어가 모두 준비되어야 시작이 허용됩니다.</li>
              <li>투표 단계에서는 생존 플레이어만 선택 가능합니다.</li>
            </ul>
          </CardFooter>
        </Card>
      </section>
    </>
  );
}

function LobbyControls({
  isHost,
  selfReady,
  everyoneReady,
  playerCount,
  pendingAction,
  onReadyToggle,
  onStart,
}: {
  isHost: boolean;
  selfReady: boolean;
  everyoneReady: boolean;
  playerCount: number;
  pendingAction: string | null;
  onReadyToggle: () => void;
  onStart: () => void;
}) {
  return (
    <div className="grid gap-3 border border-white/10 bg-white/5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-white/10 bg-white/10 text-white" variant="outline">
          Lobby
        </Badge>
        <span className="text-sm text-white/68">최소 3명, 호스트 외 전원 준비 필요</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {!isHost ? (
          <Button onClick={onReadyToggle} disabled={pendingAction !== null} className="w-full">
            {pendingAction === "ready" ? <LoaderCircleIcon className="animate-spin" /> : selfReady ? <CheckIcon /> : null}
            {selfReady ? "준비 해제" : "준비 완료"}
          </Button>
        ) : (
          <div className="flex items-center border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/65">
            호스트는 준비 대상에서 제외됩니다.
          </div>
        )}
        <Button
          onClick={onStart}
          disabled={pendingAction !== null || !isHost || playerCount < 3 || !everyoneReady}
          variant="outline"
          className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10"
        >
          {pendingAction === "start" ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />}
          게임 시작
        </Button>
      </div>
    </div>
  );
}

function PlayerRow({ player, isHost, isSelf }: { player: PublicPlayerState; isHost: boolean; isSelf: boolean }) {
  return (
    <div className="grid gap-2 border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{player.name}</span>
            {isSelf ? (
              <Badge className="border-emerald-200/20 bg-emerald-200/10 text-emerald-50" variant="outline">
                you
              </Badge>
            ) : null}
            {isHost ? (
              <Badge className="border-amber-200/20 bg-amber-200/10 text-amber-50" variant="outline">
                host
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[10px] text-white/35">{player.socketId}</p>
        </div>
        <Badge
          className={player.alive ? "border-white/10 bg-white/10 text-white" : "border-rose-200/20 bg-rose-200/10 text-rose-50"}
          variant="outline"
        >
          {player.alive ? "alive" : "out"}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-xs text-white/55">
        <span>ready</span>
        <span>{player.isReady ? "yes" : "no"}</span>
      </div>
    </div>
  );
}

function StatusRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-white/55">{icon}</div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</div>
        <div className="truncate text-sm text-white/78">{value}</div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</div>
    </div>
  );
}

function playerNameById(players: PublicPlayerState[], socketId: string) {
  return players.find((player) => player.socketId === socketId)?.name ?? socketId;
}

function roleLabel(role: "LIAR" | "CIVILIAN") {
  return role === "LIAR" ? "라이어" : "시민";
}

function formatRelative(at: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - at) / 1_000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

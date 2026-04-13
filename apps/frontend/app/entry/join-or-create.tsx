import { LoaderCircleIcon } from "lucide-react";
import { useGame } from "@/app/game-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function JoinOrCreate() {
  const { name, setName, joinCode, setJoinCode, error, pendingAction, joinRoom, createRoom } = useGame();

  return (
    <Card className="border text-foreground">
      <CardHeader>
        <CardTitle>Welcome to Liar Game Online</CardTitle>
        <CardDescription className="text-muted-foreground">
          코드를 입력하여 방에 참여하거나 새로 만들 수 있습니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="w-full">
        {error ? <p className="px-6 text-sm text-rose-200">{error}</p> : null}
        <Tabs defaultValue="join" className="w-full">
          <TabsList>
            <TabsTrigger value="join">코드로 참여</TabsTrigger>
            <TabsTrigger value="create">방 만들기</TabsTrigger>
          </TabsList>
          <TabsContent value="join">
            <label className="grid gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Player Name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: kim"
                className="border-input bg-background text-foreground placeholder:text-muted-foreground"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Room Code</span>
              <Input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ABCD12"
                className="border-input bg-background text-foreground placeholder:text-muted-foreground"
              />
            </label>
            <Button onClick={joinRoom} disabled={pendingAction !== null}>
              {pendingAction === "join" ? <LoaderCircleIcon className="animate-spin" /> : null}방 입장하기
            </Button>
          </TabsContent>
          <TabsContent value="create">
            <label className="grid gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Player Name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: kim"
                className="border-input bg-background text-foreground placeholder:text-muted-foreground"
              />
            </label>
            <label className="grid gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Room Code</span>
              <Input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="ABCD12"
                readOnly
                className="border-input bg-background text-foreground placeholder:text-muted-foreground"
              />
              {/* <Input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                placeholder="방 만들기 버튼을 눌러 코드를 생성하세요"
                readOnly
                className="border-input bg-background text-foreground placeholder:text-muted-foreground"
              /> */}
            </label>
            <Button onClick={createRoom} disabled={pendingAction !== null} className="w-full">
              {pendingAction === "create" ? <LoaderCircleIcon className="animate-spin" /> : null}방 만들기
            </Button>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

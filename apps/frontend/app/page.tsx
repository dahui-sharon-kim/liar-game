import { PlusIcon, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

import { InputGroup, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";

export default async function Page() {
  return (
    <div className="w-full h-dvh flex flex-col items-center justify-center">
      {/* <div className="bg-primary absolute inset-0 z-30 aspect-video opacity-50 mix-blend-color" />
        <img
          src="https://images.unsplash.com/photo-1604076850742-4c7221f3101b?q=80&w=1887&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
          alt="Photo by mymind on Unsplash"
          title="Photo by mymind on Unsplash"
          className="relative z-20 aspect-video w-full object-cover brightness-60 grayscale"
        /> */}
      <div className="flex flex-col items-center justify-center">
        <h1>라이어 게임에 오신 것을 환영합니다</h1>
        <dd>라이어 게임을 실시간 채팅 및 투표 기능으로 더 생동감 있게 즐겨보세요!</dd>
        <div className="flex items-center">
          <Dialog>
            <DialogTrigger asChild>
              <Button>코드로 참여하기</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>코드를 입력하세요</DialogHeader>
              <InputGroup>
                <InputGroupInput />
                <InputGroupButton>입력</InputGroupButton>
              </InputGroup>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button>
                <PlusIcon />방 만들기
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>코드를 공유하세요</DialogHeader>
              <div className="w-full flex items-center justify-between">
                <p>코드 예시</p>
                <Button variant="ghost">
                  <Copy />
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

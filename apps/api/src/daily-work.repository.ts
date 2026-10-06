import { randomUUID } from "node:crypto";
import {
  DailyWorkRecord,
  DailyWorkParticipant,
  DailyWork,
} from "@jongno/shared";
import { workMinutes } from "@jongno/shared";
import { seoulToday } from "./date";
export const DAILY_WORK_REPOSITORY = Symbol("DAILY_WORK_REPOSITORY");
export interface DailyWorkRepository {
  list(): DailyWork[];
  find(id: string): DailyWork | undefined;
  save(
    record: DailyWorkRecord,
    participants: DailyWorkParticipant[],
  ): DailyWork;
}
// Two normalized collections model daily_work and daily_work_participants.
export class SampleDailyWorkRepository implements DailyWorkRepository {
  private records: DailyWorkRecord[];
  private participants: DailyWorkParticipant[];
  constructor(today = seoulToday()) {
    this.records = [
      {
        id: "D001",
        workDate: today,
        siteId: "S001",
        siteName: "종로 오피스 소방시설 개선",
        managerId: "W001",
        managerDisplayName: "김현장 소장",
        startTime: "08:30",
        endTime: "17:20",
        content: "3층 스프링클러 배관 및 자탐 작업",
        notes: "",
        status: "작업완료",
        materialCount: 0,
        beforePhotoCount: 0,
        afterPhotoCount: 0,
      },
    ];
    this.participants = [
      { dailyWorkId: "D001", workerId: "W002", displayName: "박진행 팀장" },
      { dailyWorkId: "D001", workerId: "W003", displayName: "이소방 기사" },
    ];
  }
  private view(record: DailyWorkRecord): DailyWork {
    return {
      ...record,
      participants: this.participants
        .filter((p) => p.dailyWorkId === record.id)
        .map((p) => ({ ...p })),
      totalMinutes: workMinutes(record.startTime, record.endTime),
    };
  }
  list() {
    return this.records.map((r) => this.view(r));
  }
  find(id: string) {
    const r = this.records.find((r) => r.id === id);
    return r && this.view(r);
  }
  save(record: DailyWorkRecord, participants: DailyWorkParticipant[]) {
    const index = this.records.findIndex((r) => r.id === record.id);
    if (index < 0) this.records.push({ ...record });
    else this.records[index] = { ...record };
    this.participants = [
      ...this.participants.filter((p) => p.dailyWorkId !== record.id),
      ...participants.map((p) => ({ ...p })),
    ];
    return this.view(record);
  }
}
export const newDailyWorkId = () => randomUUID();

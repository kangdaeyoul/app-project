import { Inject } from "@nestjs/common";
import { PHOTO_REPOSITORY, PhotoRepository } from "./photo.repository";
import { randomUUID } from "node:crypto";
import {
  Material,
  MaterialUsage,
  MaterialUsageInput,
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
    materials?: MaterialUsageInput[],
  ): DailyWork;
}
// Two normalized collections model daily_work and daily_work_participants.
export class SampleDailyWorkRepository implements DailyWorkRepository {
  private records: DailyWorkRecord[];
  private participants: DailyWorkParticipant[];
  private catalog: Material[] = [];
  private usages: MaterialUsage[] = [];
  constructor(
    @Inject(PHOTO_REPOSITORY) private readonly photos: PhotoRepository,
    seed = true,
  ) {
    if (!seed) {
      this.records = [];
      this.participants = [];
      return;
    }
    const today = seoulToday();
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
      },
    ];
    this.records.push(
      ...[
        {
          id: "D002",
          siteId: "S003",
          siteName: "광화문 빌딩 정기점검",
          managerId: "W004",
          managerDisplayName: "최기계 기사",
          plannedStartTime: "09:00",
          plannedEndTime: "12:00",
          status: "작업예정" as const,
        },
        {
          id: "D003",
          siteId: "S004",
          siteName: "창신동 공동주택 배관",
          managerId: "W004",
          managerDisplayName: "최기계 기사",
          plannedStartTime: "14:00",
          plannedEndTime: "17:00",
          status: "작업예정" as const,
        },
        {
          id: "D004",
          siteId: "S004",
          siteName: "창신동 공동주택 배관",
          managerId: "W005",
          managerDisplayName: "정전기 기사",
          plannedStartTime: "13:00",
          plannedEndTime: "17:00",
          startTime: "13:00",
          status: "작업중" as const,
        },
        {
          id: "D005",
          siteId: "S003",
          siteName: "광화문 빌딩 정기점검",
          managerId: "W006",
          managerDisplayName: "한지원 기사",
          plannedStartTime: "10:00",
          plannedEndTime: "11:00",
          urgent: true,
          scheduleKind: "현장확인" as const,
          status: "작업예정" as const,
        },
      ].map((row) => ({
        workDate: today,
        startTime: "",
        endTime: "",
        content: "스케줄 확인용 샘플 작업",
        notes: "",
        ...row,
      })),
    );
    this.participants = [
      { dailyWorkId: "D001", workerId: "W002", displayName: "박진행 팀장" },
      { dailyWorkId: "D001", workerId: "W003", displayName: "이소방 기사" },
    ];
  }
  private view(record: DailyWorkRecord): DailyWork {
    return {
      ...record,
      beforePhotoCount: this.photos
        .list()
        .filter((p) => p.dailyWorkId === record.id && p.type === "작업 전")
        .length,
      afterPhotoCount: this.photos
        .list()
        .filter((p) => p.dailyWorkId === record.id && p.type === "작업 후")
        .length,
      materialCount: this.usages.filter((u) => u.dailyWorkId === record.id)
        .length,
      materials: this.usages
        .filter((u) => u.dailyWorkId === record.id)
        .map((u) => ({ ...u })),
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
  save(
    record: DailyWorkRecord,
    participants: DailyWorkParticipant[],
    materials?: MaterialUsageInput[],
  ) {
    if (materials !== undefined) {
      const next = materials.map((input) => {
        let material = this.catalog.find(
          (m) =>
            m.name === input.name &&
            m.specification === input.specification &&
            m.unit === input.unit,
        );
        if (!material) {
          material = {
            id: randomUUID(),
            name: input.name,
            specification: input.specification,
            unit: input.unit,
          };
          this.catalog.push(material);
        }
        return {
          ...input,
          id: input.id ?? randomUUID(),
          materialId: material.id,
          dailyWorkId: record.id,
        };
      });
      this.usages = [
        ...this.usages.filter((u) => u.dailyWorkId !== record.id),
        ...next,
      ];
    }
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

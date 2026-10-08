import { randomUUID } from "node:crypto";
import {
  WORKER_COLORS,
  Worker,
  WorkerInput,
  WorkerAvailability,
  WorkerWork,
} from "@jongno/shared";
import { seoulToday } from "./date";
export const WORKERS_REPOSITORY = Symbol("WORKERS_REPOSITORY");
export interface WorkersRepository {
  list(): Worker[];
  find(id: string): Worker | undefined;
  create(input: WorkerInput): Worker;
  update(id: string, input: WorkerInput): Worker | undefined;
  archive(id: string): Worker | undefined;
  availability(id: string): WorkerAvailability[];
  setAvailability(id: string, entry: WorkerAvailability): void;
  work(id: string): WorkerWork[];
}
export class SampleWorkersRepository implements WorkersRepository {
  private workers: Worker[] = [
    {
      id: "W001",
      name: "김현장",
      displayName: "김현장 소장",
      phone: "010-0000-1001",
      role: "소장",
      memo: "",
      defaultAvailability: "근무가능",
      deletedAt: null,
    },
    {
      id: "W002",
      name: "박진행",
      displayName: "박진행 팀장",
      phone: "010-0000-1002",
      role: "팀장",
      memo: "",
      defaultAvailability: "근무가능",
      deletedAt: null,
    },
    {
      id: "W003",
      name: "이소방",
      displayName: "이소방 기사",
      phone: "010-0000-1003",
      role: "기사",
      memo: "",
      defaultAvailability: "오전불가",
      deletedAt: null,
    },
  ];
  private overrides = new Map<string, WorkerAvailability[]>();
  private records: Record<string, WorkerWork[]>;
  constructor(today = seoulToday(), seed = true) {
    if (!seed) {
      this.workers = [];
      this.records = {};
      return;
    }
    this.workers.push(
      ...["최기계", "정전기", "한지원"].map((name, i) => ({
        id: `W00${i + 4}`,
        name,
        displayName: `${name} 기사`,
        phone: "",
        role: "기사",
        memo: "스케줄 샘플",
        defaultAvailability: (i === 1
          ? "오후불가"
          : i === 2
            ? "휴무"
            : "근무가능") as Worker["defaultAvailability"],
        deletedAt: null,
      })),
    );
    this.workers.forEach((w, i) => (w.color = WORKER_COLORS[i]));
    const month = today.slice(0, 7);
    this.records = {
      W001: [
        {
          id: "T001",
          siteId: "S001",
          date: today,
          scheduledAmount: 1800000,
          paidAmount: 0,
        },
      ],
      W002: [
        {
          id: "T002",
          siteId: "S003",
          date: month + "-05",
          scheduledAmount: 1000000,
          paidAmount: 350000,
        },
      ],
      W003: [
        {
          id: "T003",
          siteId: "S004",
          date: month + "-18",
          scheduledAmount: 2400000,
          paidAmount: 0,
        },
      ],
    };
  }
  list() {
    return this.workers.map((w) => ({ ...w }));
  }
  find(id: string) {
    const worker = this.workers.find((w) => w.id === id);
    return worker && { ...worker };
  }
  create(input: WorkerInput) {
    const used = new Set(this.workers.map((w) => w.color));
    let color = input.color ?? WORKER_COLORS.find((c) => !used.has(c));
    if (!color) {
      // Golden-angle hues extend the palette without reusing an exact color.
      for (let i = this.workers.length; !color; i++) {
        const hue = (i * 137.508) % 360,
          saturation = 0.62,
          lightness = 0.42;
        const a = saturation * Math.min(lightness, 1 - lightness);
        const channel = (n: number) => {
          const k = (n + hue / 30) % 12;
          return Math.round(
            255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))),
          )
            .toString(16)
            .padStart(2, "0");
        };
        const candidate = `#${channel(0)}${channel(8)}${channel(4)}`;
        if (!used.has(candidate)) color = candidate;
      }
    }
    const worker = { ...input, color, id: randomUUID(), deletedAt: null };
    this.workers.push(worker);
    return { ...worker };
  }
  update(id: string, input: WorkerInput) {
    const i = this.workers.findIndex((w) => w.id === id);
    if (i < 0) return undefined;
    this.workers[i] = { ...this.workers[i], ...input };
    return { ...this.workers[i] };
  }
  archive(id: string) {
    const w = this.workers.find((w) => w.id === id);
    if (!w) return undefined;
    w.deletedAt ??= new Date().toISOString();
    return { ...w };
  }
  availability(id: string) {
    return (this.overrides.get(id) ?? []).map((a) => ({ ...a }));
  }
  setAvailability(id: string, entry: WorkerAvailability) {
    this.overrides.set(
      id,
      [
        ...this.availability(id).filter((a) => a.date !== entry.date),
        { ...entry },
      ].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }
  work(id: string) {
    return (this.records[id] ?? []).map((w) => ({ ...w }));
  }
}

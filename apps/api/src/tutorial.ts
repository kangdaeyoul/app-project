import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import { CompanyContext } from "./company-context";
import {
  sampleSeed,
  tutorialSteps,
  TUTORIAL_VERSION,
  TutorialRole,
  TutorialProgress,
  TutorialBundle,
} from "@jongro/shared";
export const TUTORIAL_REPOSITORY = Symbol("TUTORIAL_REPOSITORY");
export interface TutorialRepository {
  get(
    key: string,
  ): { progress: TutorialProgress; bundle: TutorialBundle | null } | undefined;
  set(
    key: string,
    value: { progress: TutorialProgress; bundle: TutorialBundle | null },
  ): void;
}
@Injectable()
export class MemoryTutorialRepository implements TutorialRepository {
  private rows = new Map<
    string,
    { progress: TutorialProgress; bundle: TutorialBundle | null }
  >();
  get(key: string) {
    const value = this.rows.get(key);
    return value ? structuredClone(value) : undefined;
  }
  set(
    key: string,
    value: { progress: TutorialProgress; bundle: TutorialBundle | null },
  ) {
    this.rows.set(key, structuredClone(value));
  }
}
@Controller("tutorial")
export class TutorialController {
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(TUTORIAL_REPOSITORY) private repository: TutorialRepository,
  ) {}
  private scope() {
    this.company.assertMember();
    const i = this.company.identity;
    const role = (i.appRole ?? "admin") as TutorialRole;
    if (!["admin", "staff", "worker"].includes(role))
      throw new BadRequestException("이 역할의 튜토리얼은 준비 중입니다.");
    const key = JSON.stringify([i.companyId, i.userId, role, TUTORIAL_VERSION]);
    return {
      i,
      role,
      key,
      writeQuotes:
        role === "admin" || i.permissions?.includes("writeQuotes") === true,
    };
  }
  private current() {
    const { key, role } = this.scope();
    return (
      this.repository.get(key) ?? {
        progress: {
          version: TUTORIAL_VERSION,
          role,
          status: "new" as const,
          step: 0,
          updatedAt: null,
          samplesPresent: false,
        },
        bundle: null,
      }
    );
  }
  @Get("progress") progress() {
    return this.current().progress;
  }
  @Put("progress") save(@Body() body: any) {
    const { key } = this.scope();
    if (
      !body ||
      Object.keys(body).some(
        (k) => !["status", "step", "version"].includes(k),
      ) ||
      !["in_progress", "completed", "skipped", "new"].includes(body.status) ||
      !Number.isInteger(body.step) ||
      body.step < 0 ||
      body.step > tutorialSteps(this.scope().role, this.scope().writeQuotes).length - 1 ||
      body.version !== TUTORIAL_VERSION
    )
      throw new BadRequestException("튜토리얼 진행 정보를 확인하세요.");
    const value = this.current();
    value.progress = {
      ...value.progress,
      status: body.status,
      step: body.step,
      updatedAt: new Date().toISOString(),
    };
    this.repository.set(key, value);
    return value.progress;
  }
  @Get("samples") samples() {
    return { bundle: this.current().bundle };
  }
  @Post("samples") create() {
    const { key, i, role, writeQuotes } = this.scope(),
      value = this.current();
    if (!value.bundle)
      value.bundle = sampleSeed(i.companyId, i.userId, role, writeQuotes);
    value.progress.samplesPresent = true;
    this.repository.set(key, value);
    return value.bundle;
  }
  @Delete("samples") remove() {
    const { key } = this.scope(),
      value = this.current();
    value.bundle = null;
    value.progress.samplesPresent = false;
    this.repository.set(key, value);
    return { deleted: true, scope: "tutorial_samples_only" };
  }
  @Post("samples/:id/reset") reset(@Param("id") id:string) {
    const {key,i,role,writeQuotes}=this.scope(),value=this.current();
    const original=sampleSeed(i.companyId,i.userId,role,writeQuotes).records.find(r=>r.id===id);
    const position=value.bundle?.records.findIndex(r=>r.id===id)??-1;
    if(!original||!value.bundle||position<0)throw new BadRequestException("현재 사용자의 튜토리얼 예시만 되돌릴 수 있습니다.");
    value.bundle.records[position]=original;this.repository.set(key,value);return original;
  }
  @Put("samples/:id") edit(@Param("id") id: string, @Body() body: any) {
    const { key } = this.scope(),
      value = this.current(),
      record = value.bundle?.records.find(
        (r) => r.id === id && r.isTutorialSample,
      );
    if (
      !record ||
      !body ||
      !body.fields ||
      Object.keys(body).some((k) => k !== "fields") ||
      typeof body.fields !== "object" ||
      Array.isArray(body.fields)
    )
      throw new BadRequestException(
        "현재 사용자의 예시 데이터만 수정할 수 있습니다.",
      );
    const fields = { ...record.fields };
    for (const [k, v] of Object.entries(body.fields)) {
      if (
        !Object.hasOwn(fields, k) ||
        ["작업전", "작업후"].includes(k) ||
        (typeof v !== "string" && typeof v !== "number") ||
        (typeof v === "string" && v.length > 1000) ||
        (typeof v === "number" && (!Number.isFinite(v) || v < 0))
      )
        throw new BadRequestException("예시 입력값을 확인하세요.");
      fields[k] = v;
    }
    record.fields = fields;
    this.repository.set(key, value);
    return record;
  }
}

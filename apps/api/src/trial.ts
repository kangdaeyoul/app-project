import { BadRequestException, Body, Controller, ForbiddenException, Inject, Injectable, OnModuleDestroy, PayloadTooLargeException, Post, Req, Res, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { APP_BRAND, CurrentUser, DEFAULT_COMPANY, UserPermission } from '@jongro/shared';
import { CompanyContext, CompanyIdentity } from './company-context';
import { SupabaseAuthService } from './supabase-auth';
import { companyBranding } from './quote-presentation';

const cookie = 'field_trial';
const ttl = 2 * 60 * 60 * 1000;
type Role = 'admin' | 'staff' | 'worker';
interface Session { companyId: string; userId: string; role: Role; expires: number; requests: number; bytes: number; }
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const labels = { admin: '관리자', staff: '사내직원', worker: '작업진행자' };
const staffPermissions: UserPermission[] = ['writeQuotes', 'editSchedule', 'manageMaterials'];
/** Public product sandbox. Never issues a Supabase token or a development field_session. */
@Injectable()
export class TrialService implements OnModuleDestroy {
  private sessions = new Map<string, Session>();
  private starts = new Map<string, { count: number; until: number }>();
  private timer: ReturnType<typeof setInterval>;
  constructor(@Inject(CompanyContext) private company: CompanyContext, @Inject(SupabaseAuthService) private real: SupabaseAuthService) {
    this.timer = setInterval(() => this.prune(), 60_000); this.timer.unref();
  }
  onModuleDestroy() { clearInterval(this.timer); for (const s of this.sessions.values()) this.company.disposeTrial(s.companyId); }
  private options() { return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production' || process.env.AUTH_SECURE_COOKIE === 'true' }; }
  private token(req: Request) { return /(?:^|;\s*)field_trial=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]; }
  hasCredentials(req: Request) { return !!this.token(req); }
  private prune() {
    for (const [key,s] of this.sessions) if (s.expires <= Date.now()) { this.company.disposeTrial(s.companyId); this.sessions.delete(key); }
    for (const [key,s] of this.starts) if (s.until <= Date.now()) this.starts.delete(key);
  }
  private session(req: Request) {
    // A real identity always takes precedence; trial cannot downgrade or authorize it.
    if (this.real.hasCredentials(req)) throw new ForbiddenException('실제 계정에서 로그아웃한 뒤 체험하세요.');
    const token = this.token(req), s = token && this.sessions.get(hash(token));
    if (!s || s.expires <= Date.now()) { this.prune(); throw new UnauthorizedException('체험이 만료되었습니다. 다시 시작하세요.'); }
    if (++s.requests > 3000) throw new ForbiddenException('체험 요청 한도에 도달했습니다. 체험을 종료해 주세요.');
    return s;
  }
  private provision(seed: boolean) {
    const id = 'trial_' + randomUUID().replaceAll('-', '');
    this.company.registerTrial({ ...structuredClone(DEFAULT_COMPANY), id, name: '예시 현장관리 회사', displayName: '체험 회사', logoUrl: null, sealKey: null, quoteTemplate: null, fax: '', phone: '02-000-0000', email: 'demo@example.com', address: '예시 현장 주소', branchAddress: '', website: '',
      business: { ...DEFAULT_COMPANY.business, name: '예시 현장관리 회사', representative: '예시 대표', registrationNumber: '', corporationNumber: '', address: '예시 현장 주소', email: 'demo@example.com' } }, seed);
    return id;
  }
  start(req: Request, res: Response, body: any) {
    if (this.real.hasCredentials(req)) throw new ForbiddenException('실제 계정에서 로그아웃한 뒤 체험하세요.');
    if (!body || !['admin','staff','worker'].includes(body.role) || Object.keys(body).some(k=>k!=='role')) throw new BadRequestException('체험 역할을 선택하세요.');
    this.prune();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const rate = this.starts.get(ip) ?? { count: 0, until: Date.now()+15*60*1000 };
    if (rate.count >= 12 || (!this.starts.has(ip) && this.starts.size >= 5000)) throw new ServiceUnavailableException('잠시 후 다시 체험해 주세요.');
    rate.count++; this.starts.set(ip, rate);
    this.end(req,res);
    if (this.sessions.size >= 50) throw new ServiceUnavailableException('체험 공간이 사용 중입니다. 잠시 후 다시 시도하세요.');
    const token = randomBytes(32).toString('hex');
    this.sessions.set(hash(token), { companyId: this.provision(true), userId: 'trial-user-' + randomUUID(), role: body.role, expires: Date.now()+ttl, requests: 0, bytes: 0 });
    res.cookie(cookie,token,{...this.options(),maxAge:ttl});
    return {ok:true};
  }
  resolve(req: Request): CompanyIdentity {
    const s=this.session(req), admin=s.role==='admin';
    if (['POST','PUT','PATCH'].includes(req.method)) {
      const raw=req.headers['content-length'];
      // Check before upload interceptors buffer files. Unknown/chunked uploads are not accepted in trials.
      if(typeof raw!=='string' || !/^\d+$/.test(raw)) throw new PayloadTooLargeException('체험에서는 크기를 확인할 수 있는 요청만 허용합니다.');
      const bytes=Number(raw);
      if(!Number.isSafeInteger(bytes) || bytes>2*1024*1024 || s.bytes+bytes>4*1024*1024) throw new PayloadTooLargeException('체험은 요청당 2MB, 세션 전체 입력·업로드 4MB까지 가능합니다.');
      s.bytes+=bytes;
    }
    return { trial:true, authenticated:true, appRole:s.role, companyId:s.companyId, userId:s.userId, userDisplayName:'체험 '+labels[s.role],
      permissions: s.role==='staff'?staffPermissions:[], workerId:s.role==='worker'?'W001':undefined, accessibleSiteIds:admin?undefined:['S001','S002','S003','S004','S005'], canEditSchedule:s.role!=='worker',
      memberships:[{companyId:s.companyId,userId:s.userId,role:admin?'admin':s.role==='staff'?'member':'viewer'}] };
  }
  me(req: Request) {
    const i=this.resolve(req), s=this.session(req);
    const user:CurrentUser={id:i.userId,companyId:i.companyId,loginId:'trial',email:'',name:i.userDisplayName!,displayName:i.userDisplayName!,role:s.role,active:true,workerId:i.workerId??null,siteIds:i.accessibleSiteIds??[],permissions:(i.permissions??[]) as UserPermission[],authSource:'trial',isDemo:true,approvalStatus:'승인'};
    return this.company.run(i,()=>({user,company:companyBranding(this.company.settings()),appBrand:APP_BRAND,access:'approved',authMode:'trial',trialExpiresAt:new Date(s.expires).toISOString()}));
  }
  reset(req: Request, body: any) {
    if (!body || typeof body.seed !== 'boolean' || Object.keys(body).some(k=>k!=='seed')) throw new BadRequestException('초기화 방식을 선택하세요.');
    const s=this.session(req), old=s.companyId;
    s.companyId=this.provision(body.seed); this.company.disposeTrial(old);
    return {ok:true,seeded:body.seed};
  }
  end(req: Request,res: Response) {
    const token=this.token(req), key=token && hash(token), s=key && this.sessions.get(key);
    if(s && key){this.company.disposeTrial(s.companyId);this.sessions.delete(key);}
    res.clearCookie(cookie,this.options()); return {ok:true};
  }
}
@Controller('trial')
export class TrialController {
  constructor(@Inject(TrialService) private trial: TrialService) {}
  @Post('start') start(@Req() req:Request,@Res({passthrough:true}) res:Response,@Body() body:unknown){return this.trial.start(req,res,body);}
  @Post('reset') reset(@Req() req:Request,@Body() body:unknown){return this.trial.reset(req,body);}
  @Post('end') end(@Req() req:Request,@Res({passthrough:true}) res:Response){return this.trial.end(req,res);}
}

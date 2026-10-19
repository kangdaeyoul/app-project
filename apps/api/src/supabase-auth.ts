import { BadRequestException, ForbiddenException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import type { Request, Response } from 'express';
import { APP_BRAND, CurrentUser, UserPermission, UserRole } from '@jongro/shared';
import { CompanyContext, CompanyIdentity } from './company-context';
import { companyBranding } from './quote-presentation';
import { SITES_REPOSITORY, SitesRepository } from './sites.repository';
import { WORKERS_REPOSITORY, WorkersRepository } from './workers.repository';

export interface AuthMembership {
  user_id: string; email: string; display_name: string; requested_company: string;
  company_id: string | null; role: UserRole | null;
  approval_status: 'pending' | 'approved' | 'rejected' | 'inactive';
  active: boolean; locked: boolean; worker_id: string | null;
  site_ids: string[]; permissions: UserPermission[]; created_at: string;
}
const permissionNames = ['internalCosts','siteFinance','workerPayments','editSchedule','writeQuotes','manageMaterials','approveMaterials'];
@Injectable()
export class SupabaseAuthService {
  private requests = new WeakMap<object, Promise<{client: SupabaseClient; user: User; membership: AuthMembership}>>();
  constructor(
    @Inject(CompanyContext) private company: CompanyContext,
    @Inject(SITES_REPOSITORY) private sites: SitesRepository,
    @Inject(WORKERS_REPOSITORY) private workers: WorkersRepository,
  ) {}
  get enabled() { return !!(process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)); }
  get required() { return process.env.AUTH_MODE === 'supabase' || (process.env.NODE_ENV === 'production' && process.env.APP_ENV !== 'test') || !!process.env.SUPABASE_URL || !!process.env.SUPABASE_PUBLISHABLE_KEY || !!process.env.SUPABASE_ANON_KEY; }
  hasCredentials(req: Request) {
    return !!req.headers.authorization || parseCookieHeader(req.headers.cookie ?? '').some(c => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name));
  }
  private settings() {
    if (!this.enabled) throw new ServiceUnavailableException('Supabase 인증 환경변수가 설정되지 않았습니다.');
    const url = process.env.SUPABASE_URL!, key = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)!;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new ServiceUnavailableException('Supabase URL 설정을 확인하세요.'); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname) || (parsed.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(parsed.hostname))))
      throw new ServiceUnavailableException('Supabase URL은 HTTPS 프로젝트 URL이어야 합니다.');
    let role: string | undefined;
    try { role = JSON.parse(Buffer.from(key.split('.')[1] ?? '', 'base64url').toString()).role; } catch {}
    if (!key.startsWith('sb_publishable_') && role !== 'anon') throw new ServiceUnavailableException('공개 publishable/anon key를 사용하세요. Secret/service-role key는 지원하지 않습니다.');
    return {url: parsed.origin, key};
  }
  siteUrl() {
    const value = process.env.AUTH_SITE_URL || process.env.RENDER_EXTERNAL_URL || (process.env.NODE_ENV !== 'production' ? 'http://localhost:3000' : '');
    try {
      const u = new URL(value);
      if (u.username || u.password || u.search || u.hash || !['','/'].includes(u.pathname) || (u.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(u.hostname)))) throw Error();
      return u.origin;
    } catch { throw new ServiceUnavailableException('AUTH_SITE_URL에 앱의 HTTPS 원본 주소를 설정하세요.'); }
  }
  client(req: Request, res: Response) {
    const {url,key} = this.settings();
    const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (bearer) return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${bearer}`}}});
    const jar = new Map(parseCookieHeader(req.headers.cookie ?? '').map(c => [c.name,c.value ?? '']));
    return createServerClient(url,key,{
      cookieOptions:{httpOnly:true,secure:process.env.AUTH_SECURE_COOKIE==='true' || process.env.NODE_ENV==='production',sameSite:'lax',path:'/'},
      cookies:{
        getAll:()=>Array.from(jar,([name,value])=>({name,value})),
        setAll:cookies=>{for(const {name,value,options} of cookies){jar.set(name,value);res.cookie(name,value,{...options,maxAge:options.maxAge === undefined ? undefined : options.maxAge * 1000,httpOnly:true,secure:process.env.AUTH_SECURE_COOKIE==='true' || process.env.NODE_ENV==='production',sameSite:'lax',path:'/'});}},
      },
    });
  }
  private failure() { return new ServiceUnavailableException('사용자 승인 정보를 불러오지 못했습니다. Supabase 연결과 app_memberships 마이그레이션을 확인하세요.'); }
  private load(req: Request, res: Response) {
    if (!this.hasCredentials(req)) throw new UnauthorizedException("로그인이 필요합니다.");
    let cached = this.requests.get(req);
    if (!cached) {
      cached = (async()=>{
        const client=this.client(req,res);
        const bearer = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
        // Never authorize using getSession(), decoded JWT claims, or browser metadata alone.
        const result = bearer ? await client.auth.getUser(bearer) : await client.auth.getUser();
        if (result.error || !result.data.user) throw new UnauthorizedException('Supabase 로그인이 필요합니다.');
        const user=result.data.user;
        let {data,error}=await client.from('app_memberships').select('*').eq('user_id',user.id).maybeSingle();
        if(error) throw this.failure();
        if(!data){
          const metadata=user.user_metadata ?? {};
          const created=await client.from('app_memberships').insert({user_id:user.id,email:user.email ?? '',display_name:String(metadata.display_name ?? metadata.full_name ?? user.email ?? '').slice(0,200),requested_company:String(metadata.requested_company ?? '').slice(0,200)}).select('*').single();
          if(created.error){ // A parallel first request may have inserted the same identity.
            const retry=await client.from('app_memberships').select('*').eq('user_id',user.id).maybeSingle();
            if(retry.error || !retry.data) throw this.failure();
            data=retry.data;
          } else data=created.data;
        }
        if(data.user_id !== user.id) throw new UnauthorizedException();
        return {client,user,membership:data as AuthMembership};
      })();
      this.requests.set(req,cached);
    }
    return cached;
  }
  private currentUser(m:AuthMembership, providers:string[]=[]):CurrentUser {
    return {id:m.user_id,companyId:m.company_id ?? '',email:m.email,loginId:m.email,name:m.display_name,displayName:m.display_name,
      role:m.role ?? 'staff',active:m.active,locked:m.locked,workerId:m.worker_id,siteIds:m.site_ids,permissions:m.permissions,
      approvalStatus:({pending:'승인대기',approved:'승인',rejected:'거절',inactive:'비활성'} as const)[m.approval_status],requestedCompany:m.requested_company,appliedAt:m.created_at,
      authSource:'supabase',authProviders:providers};
  }
  private allowed(m:AuthMembership) {return m.approval_status==='approved' && m.active && !m.locked && !!m.company_id && !!m.role;}
  private identity(m:AuthMembership):CompanyIdentity {
    if(!this.allowed(m)) throw new ForbiddenException('관리자의 회사·역할 지정 및 승인이 필요합니다.');
    if(m.role==='worker' && !m.worker_id) throw new ForbiddenException('작업진행자 연결이 필요합니다.');
    const i:CompanyIdentity={authenticated:true,appRole:m.role!,companyId:m.company_id!,userId:m.user_id,userDisplayName:m.display_name,
      permissions:m.permissions,accessibleSiteIds:m.role==='admin'?undefined:m.site_ids,workerId:m.role==='worker'?(m.worker_id ?? undefined):undefined,
      canEditSchedule:m.role==='admin'||m.permissions.includes('editSchedule'),memberships:[{companyId:m.company_id!,userId:m.user_id,role:m.role==='admin'?'admin':m.role==='staff'?'member':'viewer'}]};
    this.company.run(i,()=>{if(i.workerId && (!this.workers.find(i.workerId)||this.workers.find(i.workerId)?.deletedAt))throw new ForbiddenException('유효한 작업진행자 연결이 필요합니다.');});
    return i;
  }
  async resolve(req:Request) { const {membership}=await this.load(req,req.res!);return this.identity(membership); }
  async me(req:Request,res:Response){
    const {user,membership:m}=await this.load(req,res);
    const providers=[...new Set((user.identities ?? []).map(i=>i.provider))];
    const account={id:user.id,email:user.email ?? '',providers,approvalStatus:m.approval_status};
    if(!this.allowed(m)) return {user:null,company:null,account,access:m.approval_status==='pending'?'pending':'blocked',appBrand:APP_BRAND,authMode:'supabase'};
    const identity=this.identity(m);
    return this.company.run(identity,()=>({user:this.currentUser(m,providers),company:companyBranding(this.company.settings()),account,access:m.role==='customer'?'customer':'approved',appBrand:APP_BRAND,authMode:'supabase'}));
  }
  async login(req:Request,res:Response,body:any){
    if(typeof body?.login!=='string'||typeof body?.password!=='string'||body.login.length>254||body.password.length>200)throw new BadRequestException('이메일과 비밀번호를 확인하세요.');
    const {error}=await this.client(req,res).auth.signInWithPassword({email:body.login.trim(),password:body.password});
    if(error)throw new UnauthorizedException('이메일·비밀번호 또는 이메일 인증 상태를 확인하세요.');
    res.clearCookie('field_session',{path:'/',httpOnly:true,sameSite:'lax'});
    return {ok:true};
  }
  async signup(req:Request,res:Response,body:any){
    for(const k of ['email','name','password'])if(typeof body?.[k]!=='string'||!body[k].trim()||body[k].length>200)throw new BadRequestException('가입 정보를 확인하세요.');
    if(body.password.length<8)throw new BadRequestException('비밀번호는 8자 이상이어야 합니다.');
    const {error}=await this.client(req,res).auth.signUp({email:body.email.trim(),password:body.password,options:{emailRedirectTo:this.siteUrl()+'/api/auth/callback',data:{display_name:body.name.trim(),requested_company:typeof body.companyName==='string'?body.companyName.slice(0,200):''}}});
    if(error)throw new BadRequestException('가입 요청을 처리하지 못했습니다. 이메일과 비밀번호 조건을 확인하세요.');
    return {status:'승인대기',message:'이메일 인증 후 로그인하세요. 업무 화면은 관리자가 회사와 역할을 지정하고 승인한 뒤 사용할 수 있습니다.'};
  }
  async google(req:Request,res:Response,link=false){
    const client=this.client(req,res);
    if(link)await this.load(req,res);
    const options={redirectTo:this.siteUrl()+'/api/auth/callback'};
    const {data,error}=link?await client.auth.linkIdentity({provider:'google',options}):await client.auth.signInWithOAuth({provider:'google',options});
    if(error||!data.url)throw new BadRequestException('Google 연결을 시작하지 못했습니다. Provider와 계정 연결 설정을 확인하세요.');
    res.redirect(303,data.url);
  }
  async callback(req:Request,res:Response){
    if(typeof req.query.code!=='string'||req.query.code.length>4096){res.redirect(303,this.siteUrl()+'/?auth_error=callback');return;}
    const {error}=await this.client(req,res).auth.exchangeCodeForSession(req.query.code);
    if(error){res.redirect(303,this.siteUrl()+'/?auth_error=callback');return;}
    res.clearCookie('field_session',{path:'/',httpOnly:true,sameSite:'lax'});
    res.redirect(303,this.siteUrl()+'/');
  }
  async logout(req:Request,res:Response){
    const {error}=await this.client(req,res).auth.signOut({scope:'local'});
    if(error)throw new ServiceUnavailableException('로그아웃을 완료하지 못했습니다. 다시 시도하세요.');
    return {ok:true};
  }
  async list(req:Request){
    this.company.assertMember(true);
    const {client}=await this.load(req,req.res!);
    const {data,error}=await client.from('app_memberships').select('*').or(`company_id.eq.${this.company.companyId},company_id.is.null`).order('created_at');
    if(error)throw this.failure();
    return (data as AuthMembership[]).map(m=>this.currentUser(m));
  }
  async save(req:Request,id:string,body:any){
    this.company.assertMember(true);
    if(body?.companyId!==this.company.companyId)throw new ForbiddenException('현재 회사에만 배정할 수 있습니다.');
    if(!['admin','staff','worker','customer'].includes(body.role)||!['승인대기','승인','거절','비활성'].includes(body.approvalStatus)||typeof body.active!=='boolean')throw new BadRequestException('역할과 승인 상태를 확인하세요.');
    if(!Array.isArray(body.siteIds)||body.siteIds.some((id:any)=>typeof id!=='string'||!this.sites.find(id))||!Array.isArray(body.permissions)||body.permissions.some((p:any)=>!permissionNames.includes(p))||(!['admin','staff'].includes(body.role)&&body.permissions.length))throw new BadRequestException('접근 범위를 확인하세요.');
    if(body.role==='worker'&&(!body.workerId||!this.workers.find(body.workerId)||this.workers.find(body.workerId)?.deletedAt))throw new BadRequestException('유효한 작업진행자를 연결하세요.');
    const {client}=await this.load(req,req.res!);
    const {data,error}=await client.from('app_memberships').update({company_id:body.companyId,role:body.role,approval_status:({'승인대기':'pending','승인':'approved','거절':'rejected','비활성':'inactive'} as Record<string,string>)[body.approvalStatus],active:body.active,locked:body.locked===true,
      worker_id:body.role==='worker'?body.workerId:null,site_ids:body.siteIds,permissions:body.permissions,display_name:typeof body.displayName==='string'?body.displayName.trim().slice(0,200):''}).eq('user_id',id).select('*').single();
    if(error||!data)throw new BadRequestException('승인 변경을 저장하지 못했습니다. 현재 회사 권한과 마지막 관리자 유지 조건을 확인하세요.');
    return this.currentUser(data as AuthMembership);
  }
}

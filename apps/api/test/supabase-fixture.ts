import 'reflect-metadata';
import {createServer} from 'node:http';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module';
import {createHash,randomUUID} from 'node:crypto';
const id='10000000-0000-4000-8000-000000000001', adminId='10000000-0000-4000-8000-000000000002';
export async function fixture(options?:{onSignup?:(user:any)=>Promise<void>}){
 const names=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','AUTH_MODE','AUTH_SITE_URL','AUTH_SECURE_COOKIE','APP_ENV','AUTH_GOOGLE_ENABLED','AUTH_EMAIL_ENABLED'];
 const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const people=new Map<string,any>([['member',{id,email:'member@example.test',aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),user_metadata:{display_name:'신규 사용자',role:'admin',companyId:'jongro'},identities:[{id:'email',user_id:id,provider:'email'}]}],['admin',{id:adminId,email:'admin@example.test',aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),user_metadata:{},identities:[{id:'email',user_id:adminId,provider:'email'}]}]]);
 const signupPasswords=new Map<string,string>();
 const profile=(p:any)=>({company_id:null,role:null,approval_status:'pending',active:false,locked:false,worker_id:null,site_ids:[],permissions:[],created_at:new Date().toISOString(),user_id:p.id,email:p.email,display_name:p.user_metadata?.display_name??p.user_metadata?.full_name??'',requested_company:p.user_metadata?.requested_company??'',phone:p.user_metadata?.phone??'',requested_role:p.user_metadata?.requested_role??null,registered_at:p.created_at});
 const tokens=new Map<string,any>(), rows=new Map<string,any>();let challenge='',refreshes=0;let linkError:{code:string;msg:string}|null=null;let providerRpcAvailable=true;
 const session=(user:any)=>{const access_token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,email:user.email,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';tokens.set(access_token,user);return {access_token,refresh_token:'refresh-'+user.id,token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};};
 const server=createServer(async(req,res)=>{
  const u=new URL(req.url!,'http://localhost');let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):{};
  const send=(status:number,data:any)=>{res.writeHead(status,{'Content-Type':'application/json','X-Supabase-Api-Version':'2024-01-01'});res.end(JSON.stringify(data));};
  const user=tokens.get((req.headers.authorization??'').replace(/^Bearer /,''));
  if(u.pathname==='/auth/v1/signup'){
   const existing=[...people.values()].find(p=>p.email===body.email);
   if(existing)return send(422,{code:'user_already_exists',msg:'User already registered'});
   const p={id:randomUUID(),email:body.email,aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),user_metadata:body.data??{},identities:[{id:randomUUID(),provider:'email'}],needs_confirmation:true};
   try{await options?.onSignup?.(p);}catch{return send(500,{code:'unexpected_failure',msg:'Signup transaction failed'});}
   people.set(p.id,p);signupPasswords.set(p.email,body.password);rows.set(p.id,profile(p));return send(200,p);
  }
  if(u.pathname==='/auth/v1/token'){
   if(u.searchParams.get('grant_type')==='password'){const p=[...people.values()].find(p=>p.email===body.email);if(p?.needs_confirmation&&!p.email_confirmed_at)return send(400,{code:'email_not_confirmed',msg:'Email not confirmed'});return p&&body.password===(signupPasswords.get(p.email)??'Fixture123!')?send(200,session(p)):send(400,{error:'invalid_grant',msg:'Invalid credentials'});}
   if(u.searchParams.get('grant_type')==='pkce'){return body.auth_code==='valid-code'&&createHash('sha256').update(body.code_verifier??'').digest('base64url')===challenge?send(200,session(people.get('member'))):send(400,{error:'bad_code_verifier'});}
   if(u.searchParams.get('grant_type')==='refresh_token'){refreshes++;return send(200,session(people.get('member')));}
  }
  if(u.pathname==='/auth/v1/user')return user?send(200,user):send(401,{code:'bad_jwt',msg:'Invalid token'});
  if(u.pathname==='/auth/v1/logout')return send(200,{});
  if(u.pathname==='/auth/v1/user/identities/authorize' && linkError)return send(400,linkError);
  if(u.pathname==='/auth/v1/user/identities/authorize')return user?send(200,{url:'https://accounts.google.com/o/oauth2/v2/auth?fixture=link'}):send(401,{});
  if(u.pathname==='/rest/v1/rpc/app_membership_providers'){
   if(!providerRpcAvailable)return send(404,{code:'PGRST202',message:'Missing function'});
   if(!user)return send(401,{});
   return send(200,[...rows.values()].map(m=>({user_id:m.user_id,providers:[...people.values()].find(p=>p.id===m.user_id)?.identities.map(i=>i.provider)??[],registered_at:[...people.values()].find(p=>p.id===m.user_id)?.created_at})));
  }
  if(u.pathname==='/rest/v1/app_memberships'){
   if(!user)return send(401,{});
   const target=u.searchParams.get('user_id')?.replace(/^eq\./,'');let data:any[]=[];
   if(req.method==='POST'){const row={...profile(user),...body};rows.set(row.user_id,row);data=[row];}
   else if(req.method==='PATCH'){const row=rows.get(target!);if(row && (!u.searchParams.get('approval_status') || row.approval_status===u.searchParams.get('approval_status')!.replace(/^eq\./,''))){if(row.role==='admin'&&body.role!=='admin')return send(403,{message:'Last administrator'});Object.assign(row,body);data=[row];}}
   else {
    data=target?[rows.get(target)].filter(Boolean):[...rows.values()];
    const status=u.searchParams.get('approval_status')?.replace(/^eq\./,'');if(status)data=data.filter(m=>m.approval_status===status);
    const company=/company_id\.eq\.([^,]+)/.exec(u.searchParams.get('or')??'')?.[1];if(company)data=data.filter(m=>m.company_id===null||m.company_id===company);
   }
   return String(req.headers.accept).includes('vnd.pgrst.object+json')?(data.length===1?send(200,data[0]):send(406,{code:'PGRST116',details:'The result contains 0 rows'})):send(200,data);
  }
  send(404,{});
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 process.env.SUPABASE_URL=`http://127.0.0.1:${(server.address() as any).port}`;process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';process.env.AUTH_MODE='supabase';process.env.AUTH_SITE_URL='http://localhost:3000';process.env.AUTH_SECURE_COOKIE='false';process.env.APP_ENV='test';
 async function app(){const a=await NestFactory.create(AppModule,{logger:false});a.setGlobalPrefix('api');await a.init();return a;}
 const a=await app();return {a,app,rows,people,confirmEmail:(email:string)=>{const p=[...people.values()].find(p=>p.email===email);if(!p)throw Error('Missing fixture user');p.email_confirmed_at=new Date().toISOString();},setLinkError:(value:{code:string;msg:string}|null)=>linkError=value,setProviderRpcAvailable:(value:boolean)=>providerRpcAvailable=value,setChallenge:(c:string)=>challenge=c,get refreshes(){return refreshes;},async close(){await a.close();await new Promise<void>(r=>server.close(()=>r()));for(const[k,v]of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}};
}

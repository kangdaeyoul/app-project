import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { MemoryAuthProvider } from './auth';
import { SupabaseAuthService } from './supabase-auth';
@Injectable()
export class AuthenticatedIdentityProvider {
  constructor(@Inject(MemoryAuthProvider) private demo:MemoryAuthProvider,@Inject(SupabaseAuthService) private real:SupabaseAuthService){}
  resolve(req:Request){
    if(this.real.hasCredentials(req))return this.real.resolve(req);
    if(this.demo.demoEnabled && /(?:^|;\s*)field_session=/.test(req.headers.cookie ?? ''))return this.demo.resolve(req);
    if(this.real.required)return this.real.resolve(req);
    return this.demo.resolve(req);
  }
}

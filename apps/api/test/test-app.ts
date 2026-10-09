import { NestFactory } from '@nestjs/core';
import { COMPANY_IDENTITY, CompanyIdentityProvider } from '../src/company-identity';
import { SAMPLE_IDENTITY } from '../src/company-context';
// Existing domain regression suites use a trusted server fixture, never an HTTP bypass.
// Authentication tests create AppModule directly and exercise real session cookies.
export async function createTestApp(module:any,options:any){const app=await NestFactory.create(module,options);app.get<CompanyIdentityProvider>(COMPANY_IDENTITY).resolve=()=>structuredClone(SAMPLE_IDENTITY);return app;}

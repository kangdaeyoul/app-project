import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { SampleSitesRepository, SITES_REPOSITORY } from './sites.repository';
@Controller()
class AppController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}
  @Get('health') health() { return { status: 'ok', mode: 'sample' }; }
  @Get('dashboard') getDashboard(@Query('month') month?: string) { return this.dashboard.get(month); }
  @Get('sites') getSites(@Query('month') month?: string) { return this.dashboard.get(month).sites; }
}
@Module({ controllers: [AppController], providers: [DashboardService, { provide: SITES_REPOSITORY, useClass: SampleSitesRepository }] })
export class AppModule {}

import { Body, Controller, Get, Inject, Module, Param, Post, Put, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { SitesService } from './sites.service';
import { SampleSitesRepository, SITES_REPOSITORY } from './sites.repository';
@Controller()
class AppController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}
  @Get('health') health() { return { status: 'ok', mode: 'sample' }; }
  @Get('dashboard') getDashboard(@Query('month') month?: string) { return this.dashboard.get(month); }
}
@Controller('sites')
class SitesController {
  constructor(@Inject(SitesService) private readonly sites: SitesService) {}
  @Get() list(@Query('month') month?: string) { return this.sites.list(month); }
  @Get(':id') find(@Param('id') id: string) { return this.sites.find(id); }
  @Post() create(@Body() body: unknown) { return this.sites.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: unknown) { return this.sites.update(id, body); }
}
@Module({ controllers: [AppController, SitesController], providers: [DashboardService, SitesService, { provide: SITES_REPOSITORY, useClass: SampleSitesRepository }] })
export class AppModule {}

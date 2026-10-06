import { Body, Controller, Delete, Get, Inject, Module, Param, Post, Put, Query } from '@nestjs/common';
import { DailyWorkService } from './daily-work.service';
import { SampleDailyWorkRepository, DAILY_WORK_REPOSITORY } from './daily-work.repository';
import { WorkersService } from './workers.service';
import { SampleWorkersRepository, WORKERS_REPOSITORY } from './workers.repository';
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
@Controller('workers')
class WorkersController {
  constructor(@Inject(WorkersService) private readonly workers: WorkersService) {}
  @Get() list(@Query('month') month?: string, @Query('includeDeleted') includeDeleted?: string) { return this.workers.list(month, includeDeleted === 'true'); }
  @Get(':id') detail(@Param('id') id: string, @Query('month') month?: string) { return this.workers.detail(id, month); }
  @Post() create(@Body() body: unknown) { return this.workers.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: unknown) { return this.workers.update(id, body); }
  @Delete(':id') archive(@Param('id') id: string) { return this.workers.archive(id); }
  @Put(':id/availability/:date') availability(@Param('id') id: string, @Param('date') date: string, @Body() body: unknown) { return this.workers.setAvailability(id, date, body); }
}
@Controller('daily-work')
class DailyWorkController {
  constructor(@Inject(DailyWorkService) private readonly work: DailyWorkService) {}
  @Get() list(@Query('siteId') siteId?: string,@Query('workerId') workerId?: string){return this.work.list(siteId,workerId);}
  @Get('site-materials/:siteId') materials(@Param('siteId') siteId:string){return this.work.siteMaterials(siteId);}
  @Get(':id') find(@Param('id') id:string){return this.work.find(id);}
  @Post() create(@Body() body:unknown){return this.work.create(body);}
  @Put(':id') update(@Param('id') id:string,@Body() body:unknown){return this.work.update(id,body);}
  @Post(':id/start') start(@Param('id') id:string){return this.work.clock(id,'start');}
  @Post(':id/finish') finish(@Param('id') id:string){return this.work.clock(id,'finish');}
}
@Module({ controllers: [AppController, SitesController, WorkersController, DailyWorkController], providers: [DashboardService, SitesService, WorkersService, DailyWorkService, { provide: DAILY_WORK_REPOSITORY, useClass: SampleDailyWorkRepository }, { provide: WORKERS_REPOSITORY, useClass: SampleWorkersRepository }, { provide: SITES_REPOSITORY, useClass: SampleSitesRepository }] })
export class AppModule {}

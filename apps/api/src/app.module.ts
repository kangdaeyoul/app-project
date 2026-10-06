import { InvoicesService } from './invoices.service';
import { INVOICES_REPOSITORY, SampleInvoicesRepository } from './invoices.repository';
import { FinanceService } from './finance.service';
import { FINANCE_REPOSITORY, SampleFinanceRepository } from './finance.repository';
import { ExpensesService } from './expenses.service';
import { EXPENSES_REPOSITORY, SampleExpensesRepository } from './expenses.repository';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PhotoService, UploadFile } from './photo.service';
import { PHOTO_REPOSITORY, SamplePhotoRepository } from './photo.repository';
import { FILE_STORAGE, TemporaryFileStorage } from './file-storage';
import { Body, Controller, Delete, Get, Inject, Module, Param, Post, Put, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
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
@Controller('photos')
class PhotoController {
  constructor(@Inject(PhotoService)private readonly photos:PhotoService){}
  @Get() list(@Query('siteId') siteId?:string,@Query('dailyWorkId') dailyWorkId?:string,@Query('type') type?:string,@Query('workDate') workDate?:string){return this.photos.list(siteId,dailyWorkId,type,workDate);}
  @Post('upload') @UseInterceptors(FilesInterceptor('files',20,{limits:{fileSize:10*1024*1024,files:20,fields:8}})) upload(@Body() body:Record<string,unknown>,@UploadedFiles() files:UploadFile[]){return this.photos.create(body.dailyWorkId as string,body.type as string,body,files);}
  @Put('order') order(@Body() body:{dailyWorkId:string;type:string;ids:unknown}){return this.photos.reorder(body.dailyWorkId,body.type,body.ids);}
  @Put(':id') update(@Param('id') id:string,@Body() body:unknown){return this.photos.update(id,body);}
  @Delete(':id') remove(@Param('id') id:string){return this.photos.remove(id);}
  @Get(':id/file') file(@Param('id') id:string,@Res() response:{setHeader:(key:string,value:string)=>void;send:(buffer:Buffer)=>void}){const file=this.photos.file(id);response.setHeader('Content-Type',file.mimeType);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','no-store');response.send(file.buffer);}
}
@Controller('expenses')
class ExpensesController {
  constructor(@Inject(ExpensesService) private readonly expenses: ExpensesService) {}
  @Get() list(@Query('siteId') siteId?: string, @Query('workerId') workerId?: string) {return this.expenses.list(siteId, workerId);}
  @Get(':id') find(@Param('id') id: string) {return this.expenses.find(id);}
  @Post() create(@Body() body: unknown) {return this.expenses.create(body);}
  @Put(':id') update(@Param('id') id: string, @Body() body: unknown) {return this.expenses.update(id, body);}
  @Delete(':id') remove(@Param('id') id: string) {return this.expenses.remove(id);}
}
@Controller()
class FinanceController {
 constructor(@Inject(FinanceService) private readonly finance:FinanceService){}
 @Get('sites/:id/finance') site(@Param('id') id:string){return this.finance.siteFinance(id);}
 @Get('payments-received') receipts(@Query('siteId') id:string){return this.finance.receipts(id);}
 @Post('payments-received') createReceipt(@Body() body:unknown){return this.finance.saveReceipt(body);}
 @Put('payments-received/:id') updateReceipt(@Param('id') id:string,@Body() body:unknown){return this.finance.saveReceipt(body,id);}
 @Delete('payments-received/:id') removeReceipt(@Param('id') id:string){return this.finance.removeReceipt(id);}
 @Get('settlements') settlements(@Query('siteId') siteId?:string,@Query('workerId') workerId?:string,@Query('month') month?:string){return this.finance.settlements(siteId,workerId,month);}
 @Post('worker-payments') pay(@Body() body:unknown){return this.finance.pay(body);}
 @Delete('worker-payments/:id') removePayment(@Param('id') id:string){return this.finance.removePayment(id);}
}
@Controller('invoices')
class InvoicesController {
 constructor(@Inject(InvoicesService)private readonly invoices:InvoicesService){}
 @Get() list(@Query('siteId') siteId?:string,@Query('workerId') workerId?:string){return this.invoices.list(siteId,workerId);}
 @Get('sales/:siteId') sale(@Param('siteId') siteId:string){return this.invoices.sale(siteId);}
 @Put('sales/:siteId') saveSale(@Param('siteId') siteId:string,@Body() body:unknown){return this.invoices.saveSale(siteId,body);}
 @Put('purchases/:expenseId') savePurchase(@Param('expenseId') expenseId:string,@Body() body:unknown){return this.invoices.savePurchase(expenseId,body);}
 @Put('workers/:siteId/:workerId') saveWorker(@Param('siteId') siteId:string,@Param('workerId') workerId:string,@Body() body:unknown){return this.invoices.saveWorker(siteId,workerId,body);}
}
@Module({ controllers: [AppController, SitesController, WorkersController, DailyWorkController, PhotoController, ExpensesController, FinanceController, InvoicesController], providers: [InvoicesService, {provide: INVOICES_REPOSITORY, useClass: SampleInvoicesRepository}, FinanceService, {provide: FINANCE_REPOSITORY, useClass: SampleFinanceRepository}, ExpensesService, { provide: EXPENSES_REPOSITORY, useClass: SampleExpensesRepository }, DashboardService, SitesService, WorkersService, DailyWorkService, PhotoService, { provide: PHOTO_REPOSITORY, useClass: SamplePhotoRepository }, { provide: FILE_STORAGE, useClass: TemporaryFileStorage }, { provide: DAILY_WORK_REPOSITORY, useClass: SampleDailyWorkRepository }, { provide: WORKERS_REPOSITORY, useClass: SampleWorkersRepository }, { provide: SITES_REPOSITORY, useClass: SampleSitesRepository }] })
export class AppModule {}

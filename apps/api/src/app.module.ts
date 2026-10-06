import { APP_INTERCEPTOR } from '@nestjs/core';
import { COMPANY_IDENTITY, SampleCompanyIdentityProvider, CompanyIdentityInterceptor } from './company-identity';
import { CompanyTemplateResolver } from './company-template';
import { CompanyContext } from './company-context';
import { COMPANY_DATA_PROVIDERS } from './company.providers';
import { CompanyController } from './company.controller';
import { QuoteExcelService } from './quote-excel.service';
import { QUOTE_ADMIN_ACCESS, SampleQuoteAdminAccess } from './quote-access';
import { QuotesService } from './quotes.service';
import { QuotePdfService } from './quote-pdf.service';
import { PhotoReportService } from './photo-report.service';
import { InvoicesService } from './invoices.service';
import { FinanceService } from './finance.service';
import { ExpensesService } from './expenses.service';
import { FilesInterceptor } from '@nestjs/platform-express';
import { PhotoService, UploadFile } from './photo.service';
import { Body, Controller, Delete, Get, Inject, Module, Param, Post, Put, Query, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { DailyWorkService } from './daily-work.service';
import { WorkersService } from './workers.service';
import { DashboardService } from './dashboard.service';
import { SitesService } from './sites.service';
@Controller('customers')
class CustomersController {
  constructor(@Inject(QuotesService) private readonly quotes: QuotesService) {}
  @Get() list(){return this.quotes.customersList();}
  @Post() create(@Body() body:unknown){return this.quotes.createCustomer(body);}
}
@Controller('quotes')
class QuotesController {
  constructor(@Inject(QuotesService)private readonly quotes:QuotesService,@Inject(QuotePdfService)private readonly pdf:QuotePdfService,@Inject(QuoteExcelService)private readonly excel:QuoteExcelService){}
  @Get() list(@Query('search') search?:string,@Query('status') status?:string,@Query('from') from?:string,@Query('to') to?:string){return this.quotes.list(search,status,from,to);}
  @Get(':id') find(@Param('id') id:string){return this.quotes.find(id);}
  @Get(':id/customer') customer(@Param('id') id:string,@Query('mode') mode?:string){return this.quotes.customer(id,mode);}
  @Post() create(@Body() body:unknown){return this.quotes.save(body);}
  @Put(':id') update(@Param('id') id:string,@Body() body:unknown){return this.quotes.save(body,id);}
  @Delete(':id') remove(@Param('id') id:string){return this.quotes.remove(id);}
  @Post(':id/copy') copy(@Param('id') id:string){return this.quotes.copy(id);}
  @Post(':id/convert') convert(@Param('id') id:string,@Body() body:unknown){return this.quotes.convert(id,body);}
  @Get(':id/excel') excelDownload(@Param('id') id:string,@Query('mode') mode:string='전체 상세',@Res() response:{setHeader:(key:string,value:string)=>void;send:(buffer:Buffer)=>void}) {
    const q=this.quotes.excelCustomer(id,mode);
    response.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="quote.xlsx"; filename*=UTF-8''${encodeURIComponent(q.siteName.replace(/[\\/:*?"<>|\r\n]/g,'_')+'_견적서_'+q.quoteDate+'.xlsx')}`);
    response.send(this.excel.generate(q));
  }
  @Get(':id/pdf') async print(@Param('id') id:string,@Query('mode') mode:string='전체 상세',@Query('preview') preview:string|undefined,@Res() response:{setHeader:(key:string,value:string)=>void;send:(buffer:Buffer)=>void}){
    const p=await this.pdf.render(id,mode);response.setHeader('Content-Type','application/pdf');response.setHeader('Content-Disposition',`${preview==='true'?'inline':'attachment'}; filename="quote.pdf"; filename*=UTF-8''${encodeURIComponent(p.filename)}`);response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.send(p.buffer);
  }
}
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
@Controller('sites/:siteId/photo-reports')
class PhotoReportController {
  constructor(@Inject(PhotoReportService) private readonly reports: PhotoReportService) {}
  private async send(siteId: string, body: unknown, save: boolean, response: {setHeader:(key:string,value:string)=>void;send:(buffer:Buffer)=>void}) {
    const report = await this.reports.render(siteId, body, save);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `${save ? 'attachment' : 'inline'}; filename="photo-report.pdf"; filename*=UTF-8''${encodeURIComponent(report.filename)}`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (save) response.setHeader('X-Report-Storage-Key', encodeURIComponent(report.storageKey));
    response.send(report.buffer);
  }
  @Post('preview') preview(@Param('siteId') id:string,@Body() body:unknown,@Res() response: Parameters<PhotoReportController['send']>[3]) {return this.send(id, body, false, response);}
  @Post('generate') generate(@Param('siteId') id:string,@Body() body:unknown,@Res() response: Parameters<PhotoReportController['send']>[3]) {return this.send(id, body, true, response);}
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
@Module({ controllers: [CompanyController, CustomersController, QuotesController, PhotoReportController, AppController, SitesController, WorkersController, DailyWorkController, PhotoController, ExpensesController, FinanceController, InvoicesController], providers: [{provide: COMPANY_IDENTITY,useClass:SampleCompanyIdentityProvider},{provide:APP_INTERCEPTOR,useClass:CompanyIdentityInterceptor}, CompanyTemplateResolver, CompanyContext, {provide: QUOTE_ADMIN_ACCESS,inject:[CompanyContext],useFactory:(context:CompanyContext)=>new SampleQuoteAdminAccess(context)}, QuotesService, QuotePdfService, QuoteExcelService, ...COMPANY_DATA_PROVIDERS, PhotoReportService, InvoicesService, FinanceService, ExpensesService, DashboardService, SitesService, WorkersService, DailyWorkService, PhotoService, ] })
export class AppModule {}

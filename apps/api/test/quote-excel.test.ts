import { createTestApp } from "./test-app";
import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';
import { QuotesService } from '../src/quotes.service';
import { QuoteExcelService } from '../src/quote-excel.service';
import { QUOTE_PRINT_MODES } from '@jongro/shared';
const text=(x:Uint8Array)=>strFromU8(x);
test('실제 양식: 서식/이미지/인쇄 보존, 고객 금액, 숨김 모드 및 원가 차단',async()=>{
 const app=await createTestApp(AppModule,{logger:false});await app.init();
 try{
 const quotes=app.get(QuotesService),excel=app.get(QuoteExcelService);
 const template=unzipSync(readFileSync('fixtures/quotes/jongro-2026.xlsx'));
 for(const mode of QUOTE_PRINT_MODES){
 const data=unzipSync(excel.generate(quotes.excelCustomer('Q003',mode)));
 for(const path of ['xl/styles.xml','xl/printerSettings/printerSettings1.bin'])assert.deepEqual(data[path],template[path]);
 const all=Object.entries(data).filter(([p])=>p.endsWith('.xml')).map(([,v])=>text(v)).join('');
 assert.doesNotMatch(all,/materialUnitCost|laborUnitCost|expenseUnitCost|internalGeneralCost|internalSupportCost|margin|calcChain|sharedStrings|Z:\\/);
 assert.doesNotMatch(all,/<f[ >]/);
 assert.match(text(data['xl/workbook.xml']),/Print_Area/);
 assert.doesNotMatch(all,/갑지|을지/);
 assert.deepEqual(data['xl/media/quoteseal.png'],template['xl/media/image1.png']);
 assert.deepEqual(data['xl/media/quotelogo.jpeg'],template['xl/media/image2.jpeg']);
 assert.match(text(data['xl/worksheets/sheet1.xml']),/VAT 포함 총액/);
 if(mode==='금액 숨김')assert.doesNotMatch(text(data['xl/worksheets/sheet1.xml']),/r="J26"[^>]*><v>/);
 }
 const original=quotes.find('Q001');const input={...original,status:'작성중' as const,sections:[{kind:'기계' as const,items:Array.from({length:100},(_,i)=>({...original.sections[0].items[0],name:`검증 항목 ${i}`,materialUnitCost:987654321,laborUnitCost:24681357,expenseUnitCost:1357911,notes:'=HYPERLINK("https://example.com")'}))}]};
 const created=quotes.save(input);const data=unzipSync(excel.generate(quotes.excelCustomer(created.id)));
 const all=Object.entries(data).filter(([p])=>/^xl\/worksheets\/sheet\d+\.xml$/.test(p)).map(([,v])=>text(v)).join('');
 for(let i=0;i<100;i++)assert.ok(all.includes(`검증 항목 ${i}</t>`));
 assert.match(text(data['xl/workbook.xml']),/기계 상세 내역서-7/);
 assert.doesNotMatch(all,/<f[ >]/);
 assert.doesNotMatch(all,/987654321|24681357|1357911/);
 }finally{await app.close();}
});

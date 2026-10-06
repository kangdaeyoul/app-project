import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { CustomerQuote } from '@jongno/shared';
export type ExcelQuote = CustomerQuote & { contactName: string; phone: string; groups: number[][] };
const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const xml = (d: ReturnType<typeof parse>) => strToU8(new XMLSerializer().serializeToString(d));
@Injectable()
export class QuoteExcelService {
  generate(q: ExcelQuote): Buffer {
    const files = unzipSync(readFileSync(join(__dirname, '../fixtures/quotes/jongno-2026.xlsx')));
    const wb = parse(strFromU8(files['xl/workbook.xml']));
    const rels = parse(strFromU8(files['xl/_rels/workbook.xml.rels']));
    const content = parse(strFromU8(files['[Content_Types].xml']));
    const sheets = wb.getElementsByTagName('sheets')[0];
    const names = wb.getElementsByTagName('definedNames')[0];
    const hideAmounts = q.printMode === '금액 숨김';
    const hideUnits = hideAmounts || q.printMode === '단가 숨김';
    const cover = parse(strFromU8(files['xl/worksheets/sheet1.xml']));
    const set = (d: ReturnType<typeof parse>, ref: string, value: string | number, style?: string) => {
      let cell = Array.from(d.getElementsByTagName('c')).find(c => c.getAttribute('r') === ref);
      if (!cell) {
        const row = Array.from(d.getElementsByTagName('row')).find(r => r.getAttribute('r') === ref.replace(/^[A-Z]+/, ''));
        if (!row) throw new Error(`Template row missing: ${ref}`);
        cell=d.createElement('c');cell.setAttribute('r',ref);
        const column=(r:string)=>r.match(/^[A-Z]+/)![0].split('').reduce((v,c)=>v*26+c.charCodeAt(0)-64,0);
        const after=Array.from(row.getElementsByTagName('c')).find(c=>column(c.getAttribute('r')!)>column(ref));
        row.insertBefore(cell,after ?? null);
      }
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      cell.removeAttribute('t');
      if (style) cell.setAttribute('s', style);
      if (typeof value === 'number') { const v=d.createElement('v');v.appendChild(d.createTextNode(String(value)));cell.appendChild(v); }
      else {cell.setAttribute('t','inlineStr');const is=d.createElement('is'),t=d.createElement('t');t.setAttribute('xml:space','preserve');t.appendChild(d.createTextNode(value));is.appendChild(t);cell.appendChild(is);}
    };
    set(cover,'C1',`No. ${q.id}`);set(cover,'E6',q.quoteDate);set(cover,'E7',q.siteName);set(cover,'E8',q.address);
    set(cover,'B9','거 래 처');set(cover,'E9',q.customerName);set(cover,'E10',q.phone);
    set(cover,'B32',`공사내용: ${q.workContent}\n견적 유효기간: ${q.validUntil}\n담당자: ${q.contactName}\n금액 단위: 원 / 상단 합계는 공급가액, 총액은 VAT 포함\n${q.notes}`);
    const groupedTotals=[0,0,0,0,0];
    q.sections.forEach((s,si)=>s.items.forEach((i,ii)=>groupedTotals[q.groups[si][ii]]+=i.amount));
    const values=[...groupedTotals,q.totals.generalFee,q.totals.supportFee,q.totals.adjustment];
    const labels=['1. 주자재비','2. 배관자재비','3. 전기자재비','4. 노무비','5. 경비','6. 일반관리비','7. 착·준공지원비','8. 고객가격 반올림 조정'];
    labels.forEach((label,i)=>{const r=16+i;set(cover,`C${r}`,label,'3');set(cover,`G${r}`,1);set(cover,`H${r}`,'식');if(!hideUnits)set(cover,`I${r}`,values[i]);if(!hideAmounts)set(cover,`J${r}`,values[i]);});
    [['C24','공급가액'],['C25','VAT'],['C26','VAT 포함 총액']].forEach(([r,t])=>set(cover,r,t,'3'));
    if(!hideAmounts){set(cover,'E12',`₩${q.totals.supplyAmount.toLocaleString('en-US')}`);set(cover,'J24',q.totals.supplyAmount);set(cover,'J25',q.totals.vat);set(cover,'J26',q.totals.totalAmount);set(cover,'J30',q.totals.supplyAmount);}
    files['xl/worksheets/sheet1.xml']=xml(cover);
    let next=4;
    for(const [kind,base,ranges,subtotals,last] of [
      ['기계',2,[[5,19],[23,69],[73,83],[87,96]],[20,70,84,97],99],
      ['전기',3,[[5,14],[18,45],[49,59],[63,72]],[15,46,60,73],75],
    ] as const){
      const si=q.sections.findIndex(s=>s.kind===kind);
      const source=si<0?[]:q.sections[si].items;
      const buckets=ranges.map((_,g)=>source.filter((_,i)=>Math.min(q.groups[si][i],3)===g));
      // Optional public grouping uses only sale prices. Internal costs never enter the renderer.
      if(q.printMode==='공종별 묶음')for(let g=0;g<4;g++){
        const grouped=new Map<string,typeof source[number]>();
        for(const i of buckets[g]){const old=grouped.get(i.trade);grouped.set(i.trade,{...i,name:i.trade,specification:'공종별 합계',quantity:1,unit:'식',saleUnitPrice:(old?.amount??0)+i.amount,amount:(old?.amount??0)+i.amount,notes:''});}buckets[g]=[...grouped.values()];
      }
      if(q.printMode==='총액 위주')buckets.forEach(b=>b.splice(0));
      const count=Math.max(1,...buckets.map((b,g)=>Math.ceil(b.length/(ranges[g][1]-ranges[g][0]+1))));
      const template=strFromU8(files[`xl/worksheets/sheet${base}.xml`]);
      for(let page=0;page<count;page++){
        const id=page===0?base:next++, d=parse(template);set(d,'B1',`현장명 : ${q.siteName}${page?` (계속 ${page+1})`:''}`);
        let pageTotal=0;
        ranges.forEach(([start,end],g)=>{
          set(d,`B${start-2}`,['주자재비','배관자재비','전기자재비','노무비·경비'][g]);
          const rows=buckets[g].slice(page*(end-start+1),(page+1)*(end-start+1));let sum=0;
          rows.forEach((i,index)=>{const r=start+index;set(d,`B${r}`,i.name);set(d,`C${r}`,i.specification);set(d,`D${r}`,i.unit);set(d,`E${r}`,i.quantity);set(d,`H${r}`,i.notes);if(!hideUnits)set(d,`F${r}`,i.saleUnitPrice);if(!hideAmounts)set(d,`G${r}`,i.amount);sum+=i.amount;});
          pageTotal+=sum;if(!hideAmounts)set(d,`G${subtotals[g]}`,sum);
        });
        if(!hideAmounts)set(d,`G${last}`,pageTotal);
        const path=`xl/worksheets/sheet${id}.xml`;files[path]=xml(d);
        if(page){
          const name=`을지(${kind})-${page+1}`,s=wb.createElement('sheet');s.setAttribute('name',name);s.setAttribute('sheetId',String(id+30));s.setAttribute('r:id',`rIdQuote${id}`);sheets.appendChild(s);
          const rel=rels.createElement('Relationship');rel.setAttribute('Id',`rIdQuote${id}`);rel.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet');rel.setAttribute('Target',`worksheets/sheet${id}.xml`);rels.documentElement!.appendChild(rel);
          const ct=content.createElement('Override');ct.setAttribute('PartName',`/${path}`);ct.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');content.documentElement!.appendChild(ct);
          files[`xl/worksheets/_rels/sheet${id}.xml.rels`]=files[`xl/worksheets/_rels/sheet${base}.xml.rels`];
          const area=wb.createElement('definedName');area.setAttribute('name','_xlnm.Print_Area');area.setAttribute('localSheetId',String(sheets.getElementsByTagName('sheet').length-1));area.appendChild(wb.createTextNode(`'${name}'!$A$1:$I$${last+1}`));names.appendChild(area);
        }
      }
    }
    files['xl/workbook.xml']=xml(wb);files['xl/_rels/workbook.xml.rels']=xml(rels);files['[Content_Types].xml']=xml(content);
    return Buffer.from(zipSync(files));
  }
}

// Run with the authorized source workbook path. Never modifies that workbook.
const fs = require('node:fs');
const {unzipSync,zipSync,strFromU8,strToU8}=require('fflate');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const entries=unzipSync(fs.readFileSync(process.argv[2]));
const approved={1:new Set(['C1','C2','B6','D6','B7','D7','B8','D8','B9','D9','F9','B10','D10','I6','I7','I8','I9','I10','I11','I12','I13','B12','B14','F14','G14','H14','I14','J14','K14','C16','C17','C18','C19','I30']),2:new Set(['B1','B2','C2','D2','E2','F2','G2','H2','B99']),3:new Set(['B1','B2','C2','D2','E2','F2','G2','H2','B75'])};
const parse=x=>new DOMParser().parseFromString(x,'application/xml');
const strings=Array.from(parse(strFromU8(entries['xl/sharedStrings.xml'])).getElementsByTagName('si')).map(x=>x.textContent);
for(let n=1;n<=3;n++){
 const path=`xl/worksheets/sheet${n}.xml`,d=parse(strFromU8(entries[path]));
 for(const c of Array.from(d.getElementsByTagName('c'))){
  const v=c.getElementsByTagName('v')[0];
  const text=approved[n].has(c.getAttribute('r')) ? (c.getAttribute('t')==='s'?strings[Number(v?.textContent)]:v?.textContent):null;
  while(c.firstChild)c.removeChild(c.firstChild);c.removeAttribute('t');
  if(text!=null){c.setAttribute('t','inlineStr');const is=d.createElement('is'),t=d.createElement('t');t.setAttribute('xml:space','preserve');t.appendChild(d.createTextNode(text));is.appendChild(t);c.appendChild(is);}
 }
 entries[path]=strToU8(new XMLSerializer().serializeToString(d));
}
for(const path of ['xl/calcChain.xml','xl/sharedStrings.xml'])delete entries[path];
for(const path of ['[Content_Types].xml','xl/_rels/workbook.xml.rels']){
 const d=parse(strFromU8(entries[path]));
 for(const e of Array.from(d.documentElement.childNodes))if(e.nodeType===1&&/calcChain|sharedStrings/.test(new XMLSerializer().serializeToString(e)))d.documentElement.removeChild(e);
 entries[path]=strToU8(new XMLSerializer().serializeToString(d));
}
const wb=parse(strFromU8(entries['xl/workbook.xml']));
for(const name of ['extLst','mc:AlternateContent'])for(const e of Array.from(wb.getElementsByTagName(name)))e.parentNode.removeChild(e);
entries['xl/workbook.xml']=strToU8(new XMLSerializer().serializeToString(wb));
entries['docProps/core.xml']=strToU8('<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>종로소방 견적서 양식</dc:title><dc:creator>주식회사 종로소방</dc:creator></cp:coreProperties>');
fs.writeFileSync('apps/api/fixtures/quotes/jongno-2026.xlsx',zipSync(entries));

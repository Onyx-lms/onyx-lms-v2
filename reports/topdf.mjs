import {chromium} from '@playwright/test';
import path from 'node:path';
const [,, inFile, outFile] = process.argv;
const url = 'file:///' + path.resolve(inFile).split(path.sep).join('/');
const b = await chromium.launch();
const p = await b.newPage();
await p.goto(url, {waitUntil: 'networkidle'});
await p.emulateMedia({media: 'print'});
await p.pdf({
  path: outFile, format: 'A4', printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font-family:Segoe UI,sans-serif;font-size:7pt;color:#94a3b8;padding:0 12mm;display:flex;justify-content:space-between"><span>Onyx LMS &middot; independent QA audit &middot; 27 August 2026</span><span class="pageNumber"></span></div>',
  margin: {top: '14mm', bottom: '15mm', left: '12mm', right: '12mm'},
});
await b.close();
console.log('pdf ->', outFile);

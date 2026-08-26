import {chromium} from '@playwright/test';
import path from 'node:path';
const [,, inFile, outPrefix] = process.argv;
const url = 'file:///' + path.resolve(inFile).split(path.sep).join('/');
const b = await chromium.launch();
const p = await b.newPage({viewport:{width:794,height:1123},deviceScaleFactor:1.4});
await p.goto(url, {waitUntil: 'networkidle'});
await p.emulateMedia({media: 'print'});
const sheets = await p.locator('.sheet').count();
console.log('sheets', sheets);
for (let i=0;i<sheets;i++){
  await p.locator('.sheet').nth(i).screenshot({path: outPrefix + '-' + (i+1) + '.png'});
}
await b.close();

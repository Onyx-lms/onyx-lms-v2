import { launch, newPage, signIn } from './qa-lib.mjs';
const b = await launch(); const c = await b.newContext(); const p = await newPage(c);
await signIn(p, 'superadmin');
const t = await p.evaluate(async () => (await (await fetch('/api/onyx/platform/tenants',{credentials:'include'})).json()));
console.log('count:', t.data.length);
for (const x of t.data) console.log(' ', x.id, x.slug, '| status=', x.status, '| plan=', x.plan, '| name=', x.name);
await b.close();

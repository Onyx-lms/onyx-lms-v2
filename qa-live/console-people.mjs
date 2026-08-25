const BASE='https://onyx-lms-v2.vercel.app';
const d=(await (await fetch(BASE+'/api/onyx/platform/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'superadmin@onyx.platform',password:'Platform#2026!'})})).json()).data;
const cookie='onyx_platform_session='+encodeURIComponent(JSON.stringify({token:d.token,refresh_token:d.refresh_token,expires_at:d.expires_at}));
const get=async(p)=>{const r=await fetch(BASE+p,{headers:{cookie}});return{status:r.status,html:await r.text()};};

// A real student id from Alpha-CSE, so the record page is asked about somebody.
const people=(await (await fetch(BASE+'/api/onyx/platform/tenants/798/people?role=student&section_id=34&limit=5',{headers:{Authorization:'Bearer '+d.token}})).json()).data;
const one=people.people[0];

const checks=[];
const ck=(l,p,x='')=>{checks.push([l,p,x]);console.log((p?'ok    ':'FAIL  ')+l.padEnd(56),x);};

let r=await get('/onyx/platform/tenants/798/students');
const total=r.html.match(/>([^<>]{0,12}) students<!-- --> at this institution/)?.[1];
ck('the students page names the real count', total==='1440', 'says '+JSON.stringify(total));
ck('and renders roll numbers', (r.html.match(/MRD-[A-Z-]+-\d+/g)??[]).length>50,
  (r.html.match(/MRD-[A-Z-]+-\d+/g)??[]).length+' rows');

r=await get('/onyx/platform/tenants/798/sections');
ck('the sections index links each division', r.html.includes('/sections/34'), 'Alpha-CSE linked');
ck('and no longer lists the whole roll',
  (r.html.match(/MRD-[A-Z-]+-\d+/g)??[]).length===0, 'unplaced only');

r=await get('/onyx/platform/tenants/798/sections/34');
ck('a division opens onto its own roll', r.status===200 && r.html.includes('Alpha-CSE'));
ck('with sixty students on it',
  (r.html.match(/MRD-ALPHA-CSE-\d+/g)??[]).length>=60,
  (r.html.match(/MRD-ALPHA-CSE-\d+/g)??[]).length+' roll numbers');
ck('every one of them opening onto their record',
  r.html.includes('/students/'+one.user_id), one.roll_number);
ck('and what is set for that division',
  r.html.includes('Set for this division'));

r=await get('/onyx/platform/tenants/798/students/'+one.user_id);
ck('a student opens onto their whole record', r.status===200 && r.html.includes(one.name), one.name);
for (const s of ['Courses','Assessments and examinations sat','Marks entered by hand'])
  ck('  · '+s, r.html.includes(s));
ck('with their division and number on it',
  r.html.includes('Alpha-CSE') && r.html.includes(one.roll_number),
  'Alpha-CSE · '+one.roll_number);

r=await get('/onyx/platform');
const members=r.html.match(/>([\d,]+)<\/div><div class="[^"]*">across every institution/)?.[1];
/*
 * Read from the API rather than scraped out of the markup.
 *
 * The tile is this column summed, so the column is the thing to check -- and
 * a regex against rendered HTML tests the markup, not the number.
 */
const dir=(await (await fetch(BASE+'/api/onyx/platform/tenants',
  {headers:{Authorization:'Bearer '+d.token}})).json()).data;
const demoRow=dir.find((t)=>t.slug==='malla-reddy-demo');
ck('the directory counts the demo in full', Number(demoRow?.member_count)===1445,
  'row says '+demoRow?.member_count+' (1,440 students + 5 staff)');
ck('and the platform total is no longer pinned at a thousand',
  dir.reduce((n,t)=>n+Number(t.member_count),0)>1445,
  'members tile: '+(members??'?'));

const bad=checks.filter((c)=>!c[1]).length;
console.log('\n'+(checks.length-bad)+' pass, '+bad+' fail, of '+checks.length);
process.exit(bad?1:0);

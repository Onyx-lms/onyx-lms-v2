import { launch, newPage, signIn, BASE } from './qa-lib.mjs';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
const results = { phase: 'codelab+a11y', base: BASE, steps: [], a11y: [] };
const step = (o) => { results.steps.push(o); console.log(o.verdict + '  ' + o.name.padEnd(48) + ' ' + (o.detail ?? '')); };
const b = await launch();

// ================= CODE LAB: real submit round-trip =================
{
  const ctx = await b.newContext(); const p = await newPage(ctx);
  await signIn(p, 'm_student');
  await p.goto(BASE + '/onyx/practice/18', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(10000);

  const before = await p.locator('main').innerText().catch(() => '');
  step({ name: 'codelab: problem statement renders', verdict: /sum|integer|print/i.test(before) ? 'PASS' : 'FAIL',
         detail: before.replace(/\n+/g, ' | ').slice(0, 220) });

  const buttons = await p.getByRole('button').evaluateAll((els) => els.map((e) => e.innerText.trim()).filter(Boolean));
  step({ name: 'codelab: action buttons', verdict: buttons.length ? 'PASS' : 'FAIL', detail: JSON.stringify(buttons) });

  await p.locator('.monaco-editor').first().click();
  await p.keyboard.press('Control+A');
  await p.keyboard.type('a,b=map(int,input().split())\nprint(a+b)');
  await p.waitForTimeout(1000);

  // capture only the results region, not the whole page chrome
  const runBtn = p.getByRole('button', { name: /^run$|run code|run tests/i }).first();
  let ran = 'no-button';
  if (await runBtn.count()) {
    await runBtn.click();
    await p.waitForTimeout(25000);
    const main = await p.locator('main').innerText().catch(() => '');
    const delta = main.replace(before, '');
    ran = delta.replace(/\n+/g, ' | ').slice(0, 400) || '(no change in main)';
    const good = /pass|fail|correct|wrong|output|\b3\b|error|accept/i.test(delta);
    step({ name: 'codelab: Run returns execution output', verdict: good ? 'PASS' : 'WARN', detail: ran });
  } else step({ name: 'codelab: Run returns execution output', verdict: 'WARN', detail: 'no Run button' });

  const submitBtn = p.getByRole('button', { name: /^submit/i }).first();
  if (await submitBtn.count()) {
    await submitBtn.click();
    await p.waitForTimeout(25000);
    const main = await p.locator('main').innerText().catch(() => '');
    const good = /pass|accept|solved|fail|wrong|verdict|test/i.test(main.replace(before, ''));
    step({ name: 'codelab: Submit is judged', verdict: good ? 'PASS' : 'WARN',
           detail: main.replace(before, '').replace(/\n+/g, ' | ').slice(0, 350) });
    // did the submission persist?
    const subs = await p.evaluate(async () => {
      const r = await fetch('/api/onyx/problems/18/submissions', { credentials: 'include' });
      return { s: r.status, b: (await r.text()).slice(0, 300) };
    });
    step({ name: 'codelab: submission persisted', verdict: subs.s === 200 ? 'PASS' : 'WARN', detail: subs.s + ' ' + subs.b.slice(0, 220) });
  } else step({ name: 'codelab: Submit is judged', verdict: 'WARN', detail: 'no Submit button' });
  await ctx.close();
}

// ================= ACCESSIBILITY (axe) =================
const A11Y = [
  ['anon', '/onyx/login'], ['anon', '/onyx/platform/login'], ['anon', '/'],
  ['m_student', '/onyx/dashboard'], ['m_student', '/onyx/courses'], ['m_student', '/onyx/results'],
  ['m_admin', '/onyx/people?role=student'], ['m_admin', '/onyx/settings'], ['m_admin', '/onyx/finance'],
  ['m_faculty', '/onyx/assessments'], ['m_guardian', '/onyx/family'],
  ['superadmin', '/onyx/platform'],
];
const byWho = {};
for (const [who, path] of A11Y) (byWho[who] ??= []).push(path);

for (const [who, paths] of Object.entries(byWho)) {
  const ctx = await b.newContext(); const p = await newPage(ctx);
  if (who !== 'anon') await signIn(p, who);
  for (const path of paths) {
    await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2500);
    try {
      const res = await new AxeBuilder({ page: p })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      const serious = res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
      results.a11y.push({ who, path, total: res.violations.length,
        serious: serious.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length,
          help: v.help, sample: v.nodes[0]?.html?.slice(0, 160) })),
        minor: res.violations.filter((v) => !serious.includes(v)).map((v) => v.id + '(' + v.nodes.length + ')') });
      console.log(`${serious.length ? 'FAIL' : 'PASS'}  a11y ${who}${path}`.padEnd(56) +
        ` violations=${res.violations.length} serious/critical=${serious.length}` +
        (serious.length ? ' :: ' + serious.map((v) => v.id + '×' + v.nodes.length).join(', ') : ''));
    } catch (e) { console.log('ERR a11y', who, path, String(e).slice(0, 120)); }
  }
  await ctx.close();
}

await b.close();
fs.writeFileSync('qa-results-10-codelab-a11y.json', JSON.stringify(results, null, 2));
const seriousTotal = results.a11y.reduce((n, a) => n + a.serious.length, 0);
console.log('\n=== a11y pages scanned: ' + results.a11y.length + '  serious/critical findings: ' + seriousTotal);

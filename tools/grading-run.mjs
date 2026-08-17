import fs from 'node:fs';
import { isCorrect } from '../packages/core/src/quiz/grading.ts';

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const c of cases) {
  out[c.id] = isCorrect({ id: c.id, type: c.type, answer: c.answer }, c.submitted);
}
process.stdout.write(JSON.stringify(out));

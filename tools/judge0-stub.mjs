/**
 * A stand-in for Judge0, so the Code Lab loop can be exercised end to end.
 *
 * This is NOT a sandbox and does not pretend to be one. It speaks Judge0's
 * submission protocol and returns a deterministic result, which is enough to
 * verify the parts this repository owns:
 *
 *   * that `Judge0Provider` sends the right body, with every limit set and the
 *     network switched off;
 *   * that the queue, the worker, the evaluator and partial scoring all work
 *     against a real HTTP provider rather than a fake `fetch`;
 *   * that a compile error, a timeout and a wrong answer each end up as the
 *     right verdict on the submission.
 *
 * What it deliberately does not verify is isolation -- whether a fork bomb is
 * actually contained. That needs a real Judge0 and is a deployment concern.
 *
 * The "language" is a tiny convention rather than an interpreter: the source
 * decides what happens, so a test can ask for any verdict it needs.
 *
 *   ECHO            -> prints stdin back
 *   PRINT <text>    -> prints <text>
 *   FAIL            -> exits non-zero
 *   COMPILE_ERROR   -> reports a compile error
 *   TIMEOUT         -> reports a time-limit breach
 *   OOM             -> reports memory exhaustion
 */
import http from 'node:http';

const PORT = Number(process.env.JUDGE0_STUB_PORT ?? 2358);

/** Judge0's status ids, only the ones this needs. */
const STATUS = {
  accepted: { id: 3, description: 'Accepted' },
  runtimeError: { id: 11, description: 'Runtime Error (NZEC)' },
  compileError: { id: 6, description: 'Compilation Error' },
  timeLimit: { id: 5, description: 'Time Limit Exceeded' },
};

function evaluate(source, stdin) {
  const program = String(source ?? '').trim();

  if (program.startsWith('COMPILE_ERROR')) {
    return { status: STATUS.compileError, compile_output: 'line 1: syntax error', stdout: '' };
  }
  if (program.startsWith('TIMEOUT')) {
    return { status: STATUS.timeLimit, stdout: '', time: '2.00' };
  }
  if (program.startsWith('OOM')) {
    // Judge0 reports an OOM kill as a plain runtime error; the adapter is
    // expected to recognise it from stderr.
    return { status: STATUS.runtimeError, stderr: 'MemoryError', stdout: '' };
  }
  if (program.startsWith('FAIL')) {
    return { status: STATUS.runtimeError, stderr: 'Traceback: boom', stdout: '' };
  }
  if (program.startsWith('PRINT ')) {
    return { status: STATUS.accepted, stdout: program.slice(6) + '\n', time: '0.01', memory: 2048 };
  }
  if (program.startsWith('ECHO')) {
    return { status: STATUS.accepted, stdout: String(stdin ?? ''), time: '0.01', memory: 2048 };
  }
  // Anything else prints itself, which is what the O03 tests already assume.
  return { status: STATUS.accepted, stdout: program, time: '0.01', memory: 2048 };
}

const received = [];

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/__received')) {
    // A test hook: lets the suite assert what the adapter actually sent.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(received));
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/submissions')) {
    res.writeHead(404).end('{}');
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* answered below */ }
    received.push(parsed);
    if (received.length > 200) received.shift();

    const result = evaluate(parsed.source_code, parsed.stdin);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      stdout: '', stderr: '', compile_output: '', time: '0.00', memory: 0,
      ...result,
    }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('judge0 stub listening on ' + PORT);
});

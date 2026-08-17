/**
 * LAB-02a -- sandboxed execution.
 *
 * "Isolated, resource-limited execution environments that run learner code
 * safely at classroom scale."
 *
 * This module deliberately does NOT execute anything. It defines the contract a
 * sandbox must satisfy and adapts one that does. Running learner code in the
 * API process would mean a fork bomb takes down the institution, an infinite
 * loop pins a core, and `fetch` reaches whatever the API can reach -- including
 * the database. There is no partial version of that decision worth shipping, so
 * when no sandbox is configured the answer is a clear refusal rather than a
 * local fallback.
 *
 * The interface is provider-agnostic on purpose (the proposal says the provider
 * is a discovery decision). Judge0 is adapted here because it is the common
 * self-hosted choice; swapping it is one class.
 */

export type Language =
  | 'python' | 'javascript' | 'typescript' | 'java' | 'c' | 'cpp' | 'go' | 'rust';

export const LANGUAGES: Language[] = [
  'python', 'javascript', 'typescript', 'java', 'c', 'cpp', 'go', 'rust',
];

/**
 * The limits every run is bounded by.
 *
 * All four matter and each stops a different thing: CPU stops a busy loop,
 * wall-clock stops a sleep, memory stops an allocation bomb, and processes stop
 * a fork bomb. Network is off unless a provider is explicitly told otherwise --
 * and nothing here ever tells it otherwise.
 */
export interface RunLimits {
  cpuSeconds: number;
  wallSeconds: number;
  memoryKb: number;
  maxProcesses: number;
  stdoutKb: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  cpuSeconds: 2,
  // Comfortably above the CPU limit: a program blocked on input should be
  // killed by this rather than sit until something else notices.
  wallSeconds: 6,
  memoryKb: 262_144,
  maxProcesses: 32,
  stdoutKb: 256,
};

export interface RunRequest {
  language: Language;
  source: string;
  stdin?: string | null;
  limits?: Partial<RunLimits>;
}

export type RunVerdict =
  | 'ok'
  | 'compile_error'
  | 'runtime_error'
  | 'timeout'
  | 'memory_exceeded'
  | 'output_exceeded'
  | 'internal_error';

export interface RunResult {
  verdict: RunVerdict;
  stdout: string;
  stderr: string;
  compileOutput: string;
  runtimeMs: number;
  memoryKb: number;
}

export interface ExecutionProvider {
  readonly name: string;
  supports(language: Language): boolean;
  run(request: RunRequest): Promise<RunResult>;
}

/** Thrown when no sandbox is configured. Never a reason to run code locally. */
export class NoSandboxError extends Error {
  readonly status = 503;
  constructor() {
    super('Code execution is not configured. Set ONYX_JUDGE0_URL to a sandbox endpoint.');
    this.name = 'NoSandboxError';
  }
}

/**
 * The provider used when none is configured.
 *
 * It refuses, loudly. The alternative -- quietly running learner code on the
 * API host "just in development" -- is how an unsandboxed executor reaches
 * production.
 */
export class UnconfiguredProvider implements ExecutionProvider {
  readonly name = 'unconfigured';
  supports(): boolean { return false; }
  async run(): Promise<RunResult> { throw new NoSandboxError(); }
}

/** Judge0's numeric language ids. */
const JUDGE0_IDS: Record<Language, number> = {
  c: 50, cpp: 54, java: 62, javascript: 63, python: 71,
  rust: 73, typescript: 74, go: 60,
};

/** Judge0 status ids, mapped to verdicts that mean something to a learner. */
const JUDGE0_STATUS: Record<number, RunVerdict> = {
  3: 'ok',
  4: 'runtime_error',   // wrong answer, which the evaluator decides, not this
  5: 'timeout',
  6: 'compile_error',
  7: 'runtime_error', 8: 'runtime_error', 9: 'runtime_error',
  10: 'runtime_error', 11: 'runtime_error', 12: 'runtime_error',
  13: 'internal_error',
  14: 'runtime_error',
};

type FetchLike = (url: string, init?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Judge0Options {
  baseUrl: string;
  authToken?: string | null;
  fetch?: FetchLike;
  /** Kept short: a run this slow is a run that has already failed. */
  requestTimeoutMs?: number;
}

/**
 * Judge0 adapter.
 *
 * The limits are passed explicitly on every request rather than left to the
 * server's defaults, because a misconfigured Judge0 with generous defaults is
 * indistinguishable from a working one until somebody submits a fork bomb.
 *
 * `enable_network: false` on every submission, always. There is no caller-facing
 * way to turn it on.
 */
export class Judge0Provider implements ExecutionProvider {
  readonly name = 'judge0';
  #baseUrl: string;
  #token: string | null;
  #fetch: FetchLike;
  #timeout: number;

  constructor(opts: Judge0Options) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#token = opts.authToken ?? null;
    this.#fetch = opts.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.#timeout = opts.requestTimeoutMs ?? 30_000;
  }

  supports(language: Language): boolean {
    return language in JUDGE0_IDS;
  }

  async run(request: RunRequest): Promise<RunResult> {
    if (!this.supports(request.language)) {
      return blank('internal_error', 'Unsupported language: ' + request.language);
    }
    const limits: RunLimits = { ...DEFAULT_LIMITS, ...request.limits };

    const body = {
      language_id: JUDGE0_IDS[request.language],
      source_code: request.source,
      stdin: request.stdin ?? '',
      cpu_time_limit: limits.cpuSeconds,
      cpu_extra_time: 0.5,
      wall_time_limit: limits.wallSeconds,
      memory_limit: limits.memoryKb,
      max_processes_and_or_threads: limits.maxProcesses,
      max_file_size: limits.stdoutKb,
      // Never negotiable. A sandbox that can reach the network is not a sandbox
      // for our purposes -- the API's own database is on that network.
      enable_network: false,
      redirect_stderr_to_stdout: false,
    };

    let raw: string;
    try {
      const res = await this.#withTimeout(this.#fetch(
        this.#baseUrl + '/submissions?base64_encoded=false&wait=true',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.#token ? { 'X-Auth-Token': this.#token } : {}),
          },
          body: JSON.stringify(body),
        },
      ));
      if (!res.ok) return blank('internal_error', 'Sandbox returned ' + res.status);
      raw = await res.text();
    } catch (error) {
      return blank('internal_error',
        'Sandbox unreachable: ' + (error instanceof Error ? error.message : String(error)));
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return blank('internal_error', 'Sandbox returned something that was not JSON.');
    }

    const statusId = Number((parsed.status as { id?: number } | undefined)?.id ?? 0);
    let verdict = JUDGE0_STATUS[statusId] ?? 'internal_error';
    const stderr = String(parsed.stderr ?? '');
    const memoryKb = Number(parsed.memory ?? 0);

    // Judge0 reports an OOM kill as a plain runtime error. Telling a learner
    // "runtime error" when they allocated a terabyte is not useful.
    if (verdict === 'runtime_error' && /out of memory|std::bad_alloc|MemoryError/i.test(stderr)) {
      verdict = 'memory_exceeded';
    }
    if (verdict === 'ok' && memoryKb > limits.memoryKb) verdict = 'memory_exceeded';

    let stdout = String(parsed.stdout ?? '');
    if (stdout.length > limits.stdoutKb * 1024) {
      stdout = stdout.slice(0, limits.stdoutKb * 1024);
      verdict = verdict === 'ok' ? 'output_exceeded' : verdict;
    }

    return {
      verdict,
      stdout,
      stderr,
      compileOutput: String(parsed.compile_output ?? ''),
      runtimeMs: Math.round(Number(parsed.time ?? 0) * 1000),
      memoryKb,
    };
  }

  async #withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('sandbox timed out')), this.#timeout);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }
}

function blank(verdict: RunVerdict, stderr: string): RunResult {
  return { verdict, stdout: '', stderr, compileOutput: '', runtimeMs: 0, memoryKb: 0 };
}

/**
 * Builds the provider from the environment.
 *
 * Unconfigured is a first-class outcome, not an error at boot: the rest of
 * Code Lab -- the problem bank, workspaces, the queue -- works without a
 * sandbox, and only running code does not.
 */
export function executionProviderFromEnv(env: Record<string, string | undefined> = process.env)
  : ExecutionProvider {
  const url = env.ONYX_JUDGE0_URL?.trim();
  if (!url) return new UnconfiguredProvider();
  return new Judge0Provider({ baseUrl: url, authToken: env.ONYX_JUDGE0_TOKEN ?? null });
}

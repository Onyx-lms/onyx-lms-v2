# The Code Lab sandbox (LAB-02)

Onyx does not run learner code. `ExecutionProvider` is the contract, `Judge0Provider`
adapts one implementation of it, and with nothing configured the answer is a 503 —
never a local fallback. This directory is the other half: something to configure.

```bash
docker compose -f deploy/judge0/docker-compose.yml up -d

# Prove it isolates before you point anything at it.
ONYX_JUDGE0_URL=http://127.0.0.1:2358 node tools/onyx/verify-sandbox.mjs

# Then, in .env:
ONYX_JUDGE0_URL=http://127.0.0.1:2358
```

## Docker Desktop on Windows/Mac: read this before you debug it for an hour

`isolate` builds its sandbox from cgroup v1 accounting. Docker Desktop's WSL2 VM is
cgroup v2-only by default, and the `isolate` bundled in `judge0/judge0:1.13.1`
(version 1.8.1, March 2021) predates cgroup v2 support entirely — every submission
fails identically, `internal_error` with `"No such file or directory @ rb_sysopen -
/box/script.py"`, because `isolate --cg --box-id=0 --init` cannot create
`/sys/fs/cgroup/memory/box-0/` on a v2-only host. `verify-sandbox.mjs` catches this:
all six cases fail, including the benign one, rather than reporting a false pass.

The real fix — booting the VM with `systemd.unified_cgroup_hierarchy=0` — reconfigures
Docker Desktop's *shared* VM, which restarts every container on the host, not just
this one. Do that deliberately, on purpose, when nothing else is running that matters.

**For local development, there is a second option that needs no Docker at all:**
Judge0 runs a free hosted CE instance, and the same `ONYX_JUDGE0_URL` env var can
point straight at it —

```bash
ONYX_JUDGE0_URL=https://ce.judge0.com
```

— no `ONYX_JUDGE0_TOKEN` required for the free tier. This is exactly what the
Laravel predecessor did by default (`app/Http/Controllers/student/CodeIDEController.php`,
`JUDGE0_API_URL` defaulting to `https://ce.judge0.com`) before this port existed.
Isolation there is Judge0's own responsibility, not this host's config — which is
also why `verify-sandbox.mjs` (a fork bomb, an allocation bomb, a `/etc/shadow`
read) should **not** be run against it: that is hostile load against a shared,
free, rate-limited community server that somebody else pays to keep up, not a
verification of anything under this repo's control. A plain "does it run" check
is the appropriate ceiling for a server you don't own.

The free tier has no SLA and a low daily rate limit per IP — fine for one
developer clicking Run, not for a classroom. A deployment carrying real learners
still wants either the self-hosted stack above (fixed for cgroup v1) or a paid
Judge0 host, with `ONYX_JUDGE0_TOKEN` set to match.

## Running it is not the same as isolating

`verify-sandbox.mjs` submits a fork bomb, an infinite loop, an allocation bomb, a
network call and a read of `/etc/shadow`, and checks each one was stopped. It also
submits a program that prints `42`, because a sandbox that refuses everything —
including one that is simply down — would otherwise pass every other case.

Run it after any change to `judge0.conf`, after a host kernel upgrade, and before a
deployment carries real learners. The unit suite cannot do this job: it asserts the
flags Onyx *sends*, against `tools/judge0-stub.mjs`. Whether those flags are
*enforced* is a property of the container you deployed.

You can see the difference yourself — point the verifier at the stub and it fails
five of six cases, because the stub is a protocol echo and not a sandbox at all.
That is the script working.

## Two things that will bite you

**cgroup v2.** Judge0's `isolate` needs cgroup v1 accounting. On a host running v2
only — most current Linux, and Docker Desktop's VM — limits are silently not
enforced: submissions succeed, nothing is capped, and it looks fine. Boot with
`systemd.unified_cgroup_hierarchy=0`, or use a v1 host. The verifier catches this,
which is the reason to run it rather than to trust a green `docker ps`.

**The port is loopback-only, on purpose.** Judge0 in this configuration has no
authentication worth the name. An open 2358 is a remote code execution endpoint on
your network. It belongs behind the Onyx API, never in front of it; if the API and
the sandbox are on different hosts, put a private network or an authenticated proxy
between them and set `ONYX_JUDGE0_TOKEN`.

## What Onyx sends, regardless of what the server allows

Every submission carries its own limits rather than relying on server defaults,
because a misconfigured Judge0 with generous defaults is indistinguishable from a
working one until somebody submits a fork bomb:

| Limit | Value | What it stops |
| --- | --- | --- |
| `cpu_time_limit` | 2s | a busy loop |
| `wall_time_limit` | 6s | a program blocked on input |
| `memory_limit` | 256 MB | an allocation bomb |
| `max_processes_and_or_threads` | 32 | a fork bomb |
| `max_file_size` | 256 KB | output flooding |
| `enable_network` | **false** | reaching the API's own database |

`enable_network` has no caller-facing way to be turned on, in Onyx or in
`judge0.conf`. Both locks are deliberate; the config one is what makes the first
one true even if a future caller tries.

## Scale

`COUNT` in `judge0.conf` is how many submissions run at once — match it to cores,
not to hope. A class of 200 submitting together is absorbed by the durable queue in
front of this (LAB-02b, `queue.service.ts`), which degrades in latency rather than
in correctness. Raising `COUNT` past the core count turns a latency problem into a
timeout problem.

# Verification

After the one-time development setup in the README, run **`npm run verify`**. No downloads occur in verification. A missing pinned Chromium installation fails the command rather than silently skipping browser tests.

The latest machine-readable evidence is in:

- [`results/verification.json`](../results/verification.json): overall success and elapsed time.
- [`results/measurements.json`](../results/measurements.json): per-workload build time, peak Node-process RSS, state/transition counts, completeness, and artifact bytes.
- [`results/browser.json`](../results/browser.json): actual Chromium version, exercised cases, network attempts, browser exceptions, DOM counts, and browser-suite elapsed time.
- [`results/installed.json`](../results/installed.json): isolated package installation and CLI/browser integration results.
- [`results/tests.log`](../results/tests.log): plain output from the verification commands.

## Independent semantic experiment

The baseline in `test/reference.js` uses object-valued state, a straightforward queue, and its own evaluator, transition application, and state keys. It imports no production code. The candidate engine uses positional state arrays, indexed variables, and parent-pointer search nodes.

`test/fixtures.js` generates 250 stories with seeds 1–250 using a fixed 32-bit linear congruential generator. Each has three finite variables (boolean, integer, enum), 3–7 scenes, randomized comparisons and compound conditions, constant assignments, and three invariants. Each nonterminal has at least one unconditional edge so the experiment includes more than trivially blocked initial states. The verifier compares exact reachable-state sets, every available transition, unavailable-choice rejection, every invariant/dead-end finding, unreachable scenes, shortest distances, deterministic tie paths, and replayed state. It also checks input-state immutability.

Separate adversarial fixtures cover zero-step contradictions, converging paths, inert cycles, nonterminal dead ends, unreachable endings, bad references, malformed domains, unsupported executable fields, and every search budget. This is finite differential testing, not a proof that either implementation is flawless. Both implementations interpret the same written format, so a mistaken specification could be shared.

## Browser and installed workflows

The browser suite uses real exported files under `file://`. Contexts are offline, HTTP(S) routes are denied and counted, and page exceptions fail verification. Tests click through each of the three original endings; export, import, and reload portable saves; reject invalid imports without replacing progress; inspect a shortest counterexample step by step and transfer it into the player; exercise blocked storage, corrupt stored data, the history cap, keyboard activation and visible focus, and 360-pixel viewports.

A deliberate counter model produces 1,024 reachable states and 1,025 findings: one false invariant at every state plus one nonterminal dead end. Every finding page is visited, and the DOM remains bounded. Hostile imported text includes script delimiters, HTML attributes, external URLs, and long unbroken text. It must render literally without execution, external requests, or horizontal overflow. The tests check focus and keyboard behavior, not full screen-reader compatibility or formal WCAG conformance.

The installed workflow creates a tarball, installs it into a temporary directory with `npm --offline` and an empty npm cache, and runs the actual installed binary from outside the source tree. Node socket/DNS entry points and `fetch` are denied by a verification-only guard. The installed player exports a save that the installed CLI loads. This is application-level network denial, not an OS network namespace; the environment does not permit creating a network namespace. Chromium's internal process/network behavior beyond the tested pages is outside this measurement.

## Resource measurements

Each build workload runs in its own Node process. Wall time covers reading, parsing, validation, exploration, rendering, and writing. `process.resourceUsage().maxRSS` records that Node process's peak resident set in KiB; it excludes Chromium and other processes. Workloads are:

1. The 20-scene original story (exhaustive).
2. A 10-bit independently settable counter (1,024 states, exhaustive, intentionally contradictory).
3. A 14-bit counter capped at 2,048 states (incomplete by design).

These single-run observations describe this environment, not universal performance claims. No speedup or superiority over another narrative engine is claimed. Artifact hashes are deterministic for exhaustive and fixed-work-budget searches; runtime/RSS evidence is expected to vary between runs.

## Regression coverage and remaining limits

Node tests include successful saves and checksum/replay rejection, input and output bounds, output collisions (including empty directories and symlinks), injected serialization and write failures, cleanup, cancellation during traversal and writing, real CLI SIGINT, deterministic repeated exports, hostile text escaping, and input hashes remaining unchanged. Publication checks bound normal source/evidence paths to 10 MiB per file, 32 MiB total, and 1,000 files.

The suite does not establish literary quality, psychological realism, correctness of undeclared properties, protection against an attacker concurrently rewriting local files, termination of every cyclic playthrough, or behavior in every browser. Filesystem crashes and uncatchable process termination can leave partial output. Save checksums are not authentication. See [semantics](semantics.md) for exact limits and assumptions.

# Character Continuity Studio

Write a finite branching story, check its declared continuity rules, and share a self-contained offline player. Every diagnostic has a replayable path; every choice explains its conditions. There are no runtime dependencies, network calls, imported scripts, or model inference.

The included original story, **The Bellwether Ledger**, follows Mira, Ivo, and Sera through a flooded lighthouse. Its 20 scenes lead to three endings about public truth, shelter, and repair. Listening to a remembered rescue and making a privacy commitment change which actions are possible. Start by playing; the introduction and objective are in the game.

## Play and inspect

Requires **Node.js 22 or later**. From this checkout:

```sh
node src/cli.js validate stories/bellwether.json
node src/cli.js check stories/bellwether.json
node src/cli.js build stories/bellwether.json /tmp/bellwether-export
```

The output directory must not exist; its parent must exist. Open `/tmp/bellwether-export/player.html` directly in Chromium. Open `report.html` to inspect scenes, state changes, and shortest replays. Both work from `file://`, including on another computer, without a server. `report.json` contains the full machine-readable exploration. Nothing is deployed.

To install the CLI from this checkout, with no registry access:

```sh
npm pack --offline --ignore-scripts
npm install --offline --ignore-scripts --no-audit --no-fund --prefix /tmp/continuity-local ./character-continuity-studio-1.0.0.tgz
/tmp/continuity-local/node_modules/.bin/continuity --help
```

The package has **zero runtime dependencies**. Playwright is only a development dependency for browser verification.

## Find and repair a contradiction

```sh
node src/cli.js build stories/broken-promise.json /tmp/broken-promise-export
node src/cli.js replay stories/broken-promise.json pledge publish
```

Open the broken example's `report.html`, select its invariant finding, and step through `pledge` → `publish`. The exact assignments are displayed alongside the choice conditions. **Export witness save** transfers that outcome into the player. This fixture also includes an inert cycle and unreachable scenes.

`check` exits **0** for an exhaustive clean model, **2** for findings, unreachable scenes, progression traps, or cycles, **3** for incomplete exploration or progression analysis, **1** for input/export errors, and **130** for cancellation. `build` exits **0 when files are successfully written**, even when they report contradictions. Always inspect `exhaustive`, `reasons`, `findings`, `unreached`, and `progression` in `report.json`.

## Author a story

Edit JSON, validate it, then export to a new directory. Scene IDs and globally unique choice IDs are stable names. State is finite: booleans, bounded integers, and enumerations. Character memories and commitments are explicit state with owners. Conditions are data, and effects are simultaneous constant assignments. There is no arbitrary code, interpolation, random behavior, arithmetic, or automatic time passage.

- [Format and authoring walkthrough](docs/authoring.md)
- [Semantics, checking algorithm, limits, and save contract](docs/semantics.md)
- [Progression, cycles, fairness, and examples](docs/progression.md)
- [Related work: ink and Yarn Spinner](docs/related-work.md)
- [Verification and measured results](docs/verification.md)

## Verify

Provision the development dependencies and pinned Chromium once (these two setup commands need network access on a fresh machine):

```sh
npm ci --ignore-scripts --cache .cache/npm
PLAYWRIGHT_BROWSERS_PATH=.cache/browsers npx --no-install playwright install chromium
```

Then the single verification command is:

```sh
npm run verify
```

It does not download anything. It runs semantic and failure-path tests, checks 250 seeded stories against an independent enumerator, installs the packaged CLI offline into an isolated temporary directory with an empty npm cache, exercises its browser artifacts with external networking blocked, and records measured runtime, Node peak RSS, artifact sizes, browser version, and DOM counts in `results/`. Chromium needs its usual OS libraries. Set `PLAYWRIGHT_BROWSERS_PATH` if using an existing compatible installation. `npm test` runs the Node tests without requiring Chromium.

## Boundaries

These checks establish **only author-declared formal properties** of this finite model. They do not establish literary quality, psychological realism, factual truth, or general character intelligence. Ending reachability alone does not prove that every possible playthrough terminates. The progression report separately checks for cycles and states with no ending route. A player can revisit cycles until the history cap.

Portable saves contain a version, exact input-content hash, validated choice history, and an unkeyed checksum. Imported state is never trusted: it is reconstructed by replay. The checksum detects accidental or unrecomputed edits; it is **not authentication**. Anyone who can author a valid alternate history can recompute its checksum. Any change to story bytes, including whitespace, makes old saves incompatible. Storage on `file://` is browser-dependent; failed storage is reported, and exported files are the durable transfer mechanism.

The author report renders at most 20 list entries and one replay step at a time. Search and output caps are enforced, and incomplete checks never label unseen scenes unreachable. See the detailed [limits and caveats](docs/semantics.md#limits).

Code and original story: MIT license. No account access, private data, paid compute, or external inference is required.

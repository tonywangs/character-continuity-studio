# Semantics and guarantees

## Deterministic transitions

`src/engine.js` is shared by Node and the generated browser application. Presentation never applies its own state changes. A state is `{ scene, values }`, where `values` follows the declaration order of the story's variables. Initial state comes from `start` and each variable's `initial` value.

A choice is available exactly when its condition is true in the state before the choice. Effects assign declared constants simultaneously, and the scene changes to `to`. No intermediate assignment states are observable. The engine returns a fresh state and a list of actual variable changes. Assignments that leave a value unchanged do not produce a change record. Prose, conditional lines, and invariant warnings have no effects. Revisiting the same scene and values is semantically the same state: history length, visit counts, and presentation do not influence the model.

The public JavaScript engine API expects validated model states from `initial`, `step`, or `replay`. It is not an interpreter for arbitrary caller-provided state objects. CLI input and save entry points validate untrusted data before using the engine. Imported JSON never becomes code or HTML. All story fields are rendered with `textContent`; the generated executable script and stylesheet are fixed project code pinned by CSP hashes, with connections denied by the page policy.

## Search

`src/search.js` runs breadth-first traversal, starting with the initial state. The visited key is the scene ID plus every variable value in declaration order. Parent pointers store the first path to a state. Because edges represent one choice each and the queue is breadth-first, each observed witness has the fewest choices. Ties follow scene choice order. Different paths to an identical state are merged, which is valid because future behavior depends only on that state.

Each checked state is evaluated against every invariant. Failed invariants are findings; exploration continues through them. A nonterminal state with zero available choices is a dead-end finding. Terminal scenes are never expanded. A scene is unreachable only if exploration was exhaustive and it was not encountered. In an incomplete search it is `not-observed`, including unobserved endings. The `processed` count means states whose properties and available choices were checked, not that all their outgoing edges fit the transition budget.

The report includes every retained finding, not only the first failure per invariant. Finding entries point to nodes; use their parent chain to recover a replay. A discovered node may not have been property-checked when a time, transition, finding, or cancellation limit stopped the search. `counts.processed` describes the checked prefix. A violation can therefore exist among discovered but not yet checked nodes without appearing in `findings` in an incomplete report.

The checker does **not** prove eventual termination or eventual reachability of an ending from every state. An inert self-loop is not a dead end; it can be traversed forever in the mathematical model. A model with no findings may still be unpleasant, implausible, or impossible to finish from some branches. Properties are observations over declared state, not judgments of character motivation or truth.

## Limits

Hard ceilings live in `src/limits.js`. Search options may lower these ceilings, never raise them.

| Resource | Ceiling |
| --- | ---: |
| UTF-8 source | 1 MiB |
| Characters | 12 |
| Scenes | 200 |
| Choices per scene | 20 |
| Variables / effects per choice | 32 / 32 |
| Integer or enum domain per variable | 32 values |
| Invariants | 64 |
| Condition depth / nodes | 8 / 64 |
| Children per `all` / `any` | 16 |
| Scene conditional lines | 16 |
| General text field | 12,000 UTF-16 code units |
| Title / variable label | 200 code units |
| Character name / description | 100 / 2,000 code units |
| Choice text / invariant message | 1,000 / 2,000 code units |
| Identifier / enum value | 48 / 80 code units |
| Discovered states | 20,000 |
| Attempted available transitions | 200,000 |
| Findings | 20,000 |
| Search elapsed time | 30,000 ms |
| CLI operation deadline | 60,000 ms (cooperative) |
| Witness depth / play and save history | 2,000 choices |
| Imported / exported save | 256 KiB |
| Each export artifact / combined output | 8 MiB / 24 MiB |
| Report list DOM | 20 entries and one inspected replay step |

The product of variable domains is intentionally not enumerated in advance. Only reachable states are explored, under work and memory-cardinality limits. A declaration can describe a much larger theoretical state space. Use smaller domains and explicit search budgets when authoring. If output bytes exceed the artifact cap, export fails before creating an output directory; lower the search limits. The renderer creates one text element per prose field, regardless of embedded blank-line count.

CLI flags:

```sh
node src/cli.js check stories/bellwether.json --states 100 --transitions 500 --findings 100 --depth 30 --milliseconds 2000
node src/cli.js build stories/bellwether.json /tmp/limited-report --states 100
```

An incomplete report is a useful partial result, never a successful proof of absence. Timing is checked per state; traversal yields every 64 states for cancellation. Time limits are cooperative: a currently executing bounded evaluation/serialization or an OS filesystem operation is not forcibly interrupted. The overall CLI timer requests cancellation, and exports check cancellation before and during writes. This is not a hard-real-time system or an OS resource sandbox. SIGINT and SIGTERM use the same cancellation path. SIGKILL, power loss, or hostile concurrent filesystem mutation cannot guarantee cleanup.

## Exports and failure handling

Exports are create-only. An existing file, empty directory, nonempty directory, or symlink at the destination is an error. The parent must already exist. All three artifacts are rendered and byte-checked first. The source is read again before writing; a changed hash aborts the export.

Exclusive directory creation establishes ownership. Files are written into a `.staging` subdirectory and then moved into place. A caught write failure or cancellation removes that owned directory. Existing destinations are never removed. A concurrent observer may see a temporary destination/staging directory; success is signaled by CLI exit, not directory existence. A forced process kill can leave a directory behind. Inspect and remove such a partial directory manually before retrying. Do not concurrently modify output folders while an export is running.

No input bytes are rewritten. Repeated exhaustive exports from identical input and software are byte-identical, as are exports that stop at the same deterministic work budget. Wall-time-limited searches can stop at different states on different runs or hardware; their partial reports need not be identical. Measured timing and environment data live in `results/`, never inside reproducible story artifacts.

## Portable saves

A version-1 save has exactly these fields:

```json
{
  "format": "continuity-save",
  "version": 1,
  "storyHash": "64 hexadecimal SHA-256 characters of the exact UTF-8 source bytes",
  "choices": ["enter", "listen"],
  "checksum": "SHA-256 of the canonical payload described below"
}
```

The checksum payload is `JSON.stringify(["continuity-save", 1, storyHash, choices])`, encoded as UTF-8. Hashes are lowercase hexadecimal. The decoder checks fields, version, source hash, history size, identifier syntax, and checksum, then replays every choice from the initial state. A choice must be available in its replayed scene. No saved state snapshot is accepted. Imported `state` or other extra fields are rejected.

The browser checks file size before reading and again when decoding text. The CLI uses a capped read. A failed import leaves the current history, scene, and state untouched. Browser actions are locked while an import or save action is being validated. Version 1 has no migration path: any story-byte change, including whitespace, requires a new playthrough or a deliberate external migration tool (not supplied).

This checksum is an integrity check, **not a signature, secret, or anti-cheat mechanism**. A manually altered valid history with a recomputed checksum is indistinguishable from that legitimate playthrough. Saves do not promise authorship or provenance.

The browser tries local storage after actions and reports unavailable or full storage. A corrupt stored save is not replaced during startup. A later player action saves the new progress if storage works. A new context or device can import an exported file. `file://` storage scope and persistence are browser-dependent; only explicit file export is intended for reliable transfer. Browser downloads require the user to retain the downloaded file.

## Architecture

- `validate.js`: strict, bounded declarative format and domain/reference validation.
- `engine.js`: pure condition evaluation, explanations, transitions, and replay.
- `search.js`: bounded graph exploration and shortest witnesses.
- `saves.js`: portable history checksum and validation.
- `export.js`: bounded input read, content identity, CSP-protected HTML, create-only writes.
- `cli.js`: commands, exit statuses, and cooperative process cancellation.
- `web/app.js`: accessible native controls, safe text presentation, save transfer, and paginated diagnostics.

The generator combines these trusted JavaScript modules into each HTML file; story strings are JSON-escaped, including closing-script delimiters. This build is self-contained and has no runtime bundler dependency. Generated exports should be regenerated after engine or presentation changes; a story hash identifies content, not the software version.

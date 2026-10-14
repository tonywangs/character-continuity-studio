# Progression analysis

Build any story with the existing CLI and open `report.html`. The progression summary separates states that can reach an ending, states with no ending route, unresolved states, and cyclic components. Use the report selector to browse **No route to an ending**, **Unresolved progression**, **Cycles permitting indefinite play**, or **Nonterminal dead ends**. Every list is paginated at 20 rows. Select a row to inspect its state and replay choices. The full result is also in `report.json`.

## Three different questions

An ending is **reachable** from a state when at least one finite sequence of available choices leads to an ending. This is an existential property. It says nothing about whether the player will take that sequence.

**Every play reaches an ending** means every maximal choice sequence from the initial state ends at an ending. We consider continued choice-taking, not a human closing the browser or declining to click. In a finite exhaustive graph this holds exactly when there are no reachable cycles and no nonterminal dead ends. A reachable cycle refutes it even when that cycle has an exit. A dead end is a finite failed play; a closed cycle supports infinite failed plays. Both can have no ending route, but they are different diagnostics.

**Termination under fairness assumptions** restricts the allowed infinite plays. Weak fairness can require an action that stays continuously enabled to eventually occur; strong fairness can require an action enabled infinitely often to eventually occur. These are extra behavioral assumptions, not consequences of an exit existing. The analyzer imposes neither and does not implement a fairness checker. For the two-state rehearsal example, the exit is enabled only on visits to the rehearsal state: a weak fairness assumption on that exit alone would not rule out alternating forever; strong fairness on that exit would. See [Lamport's tutorial](https://lamport.azurewebsites.net/tla/tutorial/session9.html).

The browser's 2,000-choice history cap limits stored play; it does not turn a model cycle into an ending. “Indefinite play” describes the declared finite-state transition model, not infinite storage in the application.

## Report contract

Story format and save version remain 1. The exploration JSON is now **format 2**, with the existing nodes, findings, limits, and unreached scenes plus:

- `edges`: observed `{from, to, choice}` transitions using zero-based indices into `nodes`. An attempted edge whose new destination could not be retained is omitted; `counts.transitions` still counts attempted transitions.
- `progression.format: 1`, `complete`, and `everyPlayReachesEnding` (`"true"`, `"false"`, or `"unresolved"`). Graph exploration completeness remains `report.exhaustive`; analysis completion is separate.
- `progression.states`: one `{node, scene, endingReachability}` per discovered state when analysis completes. Status is `reachable`, `no-route`, or `unresolved`. An ending reaches itself with zero choices. Follow the referenced node's parent pointers, or call `witness(report, node)`, for its shortest entry path.
- `progression.cycles`: one record per observed cyclic strongly connected component. Each supplies `id`, representative `node`, all affected `nodes`, sorted unique `scenes`, `endingReachability`, `entryPath` choice IDs, `cycle` choice IDs, and matching `cycleEdges` indices. Cycle membership refers to the observed graph; missing edges may merge components in a later exploration.
- `progression.counts`: ending-reachable, no-route, unresolved state totals and cyclic-component count. These are separate from legacy invariant/dead-end `counts.findings` and its limit.

Components are ordered by their lowest BFS node index. This index also chooses a nearest entry state, with ties following discovery order. The entry path is shortest. The cycle begins at that state, contains at least one edge, and returns to the identical scene **and all variable values**. Its repetition remains valid because history does not affect transitions. The cycle itself is **not claimed shortest**, and reporting one cycle per component does not enumerate all cycles.

The inspector presents entry plus one cycle. **Replay cycle again** returns the replay cursor to the entry, so Next step can traverse it again. **Export witness save** imports into the unchanged player and supports continuing the story. Graph witnesses can exceed the portable-save history limit when entry and cycle are combined. The inspector can still examine them, but save export reports the existing history-limit error; it never truncates or weakens save validation.

## Incomplete work and budgets

Observed routes to an ending and observed cycles are positive evidence even in partial graphs. Without exhaustive exploration, every state lacking an observed ending route is conservatively `unresolved`, including closed regions that might admit a stronger local proof. We never infer `no-route` from a missing edge at a search boundary. A cycle still refutes universal termination. In the absence of a cycle, this implementation leaves universal termination unresolved for every incomplete exploration, even when an observed dead end could already refute it; dead-end findings remain available separately.

Progression shares the search elapsed-time budget and AbortSignal, with cooperative checkpoints during graph construction, reachability, component discovery, and witness generation. If this phase is interrupted, `complete` is false, `reason` explains why, counts are null, state/cycle lists are empty, and universal termination is unresolved. No partially constructed classification is published. Completed exploration is retained. CLI `check` exits 3 for either incomplete phase, and exits 2 for progression traps or cycles as well as existing diagnostics. `build` still exits 0 on successful export; inspect both completeness fields.

Graph storage is bounded by existing state/transition ceilings. Iterative traversals avoid recursion depth failures. Materializing entry paths costs additional space proportional to emitted witness lengths. Output byte caps still apply; large reports can fail export and require lower search limits. Timing checks, serialization, and filesystem cancellation remain cooperative. Fixed work budgets yield deterministic JSON; timing-dependent cutoffs do not promise byte-identical results.

## Authored examples and original audit

```sh
node src/cli.js build stories/recoverable-loop.json /tmp/recoverable-report
node src/cli.js build stories/progression-trap.json /tmp/trap-report
```

`recoverable-loop.json` has four reachable states. Every state can reach the performance ending, yet the two-state rehearsal/listening component permits indefinite play. `enter`, then repeated `listen`, `again`, is the witness. Choose `perform` to exit. This is a recoverable loop, not a forced failure.

`progression-trap.json` has three reachable states, all with no ending route, and the same two-state cycle. The declared performance ending is unreachable. The initial state inevitably enters the closed rehearsal region; there are no nonterminal dead ends. Movement alone does not guarantee progress.

The unchanged **Bellwether Ledger** exhaustively has 526 states and 549 transitions. All 526 states can reach an ending, there are no cyclic components, and every maximal model play reaches an ending. All 20 scenes and three endings remain reachable. This stronger progression result is distinct from the historical continuity audit; neither result evaluates literary quality. Reproduce with `npm run verify`; current measurements and independent comparisons are in `results/`. Historical evidence is retained in `results/baseline/`.

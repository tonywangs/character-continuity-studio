# Related work

Reviewed primary sources on 2026-10-14. This is a small, constrained workbench, not a claim to have invented branching narrative, persistent character state, or model checking.

## ink

[ink's implementation and overview](https://github.com/inkle/ink) describe a scripting language and runtime for highly branching interactive narrative, with a compiler, Inky editor, and JavaScript runtime integration. Its [writing manual](https://github.com/inkle/ink/blob/master/Documentation/WritingWithInk.md) covers choices, diverts, variables, conditions, and structured narrative flow.

The lesson for this project is to separate story evaluation from presentation and keep explicit identifiers for branch targets. This workbench uses a smaller JSON language and an enumerated state space. It does not import ink, implement ink syntax, offer ink's expressive range, or replace Inky. No ink implementation code was copied.

## Yarn Spinner

[Yarn Spinner's implementation](https://github.com/YarnSpinnerTool/YarnSpinner) provides a dialogue scripting system. Its primary documentation describes [variables](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/logic-and-variables) and [flow control](https://docs.yarnspinner.dev/write-yarn-scripts/scripting-fundamentals/flow-control), including conditional options. The runtime can provide unavailable options to the host game, which chooses how to display them.

Here, unavailable choices remain visible with their unmet conditions. Character-owned memories and commitments are typed fields with declared meaning, not inferred beliefs. This workbench neither imports Yarn scripts nor supports host commands and external functions. No Yarn Spinner implementation code was copied.

## Bounded scope

The useful deliverable is an integrated author loop: edit data, validate types and references, enumerate reachable scene/state pairs, inspect shortest violating paths, and play or transfer those paths offline. Breadth-first search and replay validation are established techniques. The independent reference experiment tests this particular implementation; it does not establish that all narrative engines should use these constraints or that this tool is better than existing authoring systems.

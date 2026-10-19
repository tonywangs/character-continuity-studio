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

## Graph progression analysis

This extension uses established graph algorithms and makes no novelty claim. Reviewed primary implementations include Sedgewick and Wayne's [Kosaraju–Sharir SCC implementation](https://raw.githubusercontent.com/kevin-wayne/algs4/master/src/main/java/edu/princeton/cs/algs4/KosarajuSharirSCC.java) and their [BruteSCC reference](https://algs4.cs.princeton.edu/42digraph/BruteSCC.java.html). The former uses two directed traversals; the latter groups mutually reachable vertices using transitive closure. Our implementation uses iterative stacks and observed choice-labelled edges; our separate test oracle uses all-pairs closure with an independently interpreted story graph. No source code from those implementations is incorporated.

Reverse reachability from ending states identifies states with a possible ending route. Strongly connected components identify repeatable behavior; an exit does not remove a cycle. [Lamport's fairness tutorial](https://lamport.azurewebsites.net/tla/tutorial/session9.html) distinguishes continuously enabled actions from actions enabled infinitely often. We do not assume either fairness condition for a player's choices. The [progression contract](progression.md) documents these distinctions and conservative handling of partial exploration.

## Local character conversation and memory

Reviewed primary sources on 2026-10-19. [SillyTavern's character documentation](https://github.com/SillyTavern/SillyTavern-Docs/blob/main/Usage/Characters/index.md) describes characters with names, personalities, and conversation histories. Character chat with saved history is established functionality; this project does not claim novelty or compatibility with its card format.

[Generative Agents (Park et al., 2023)](https://arxiv.org/abs/2304.03442) combines stored experiences with reflection and retrieval to support behavior. Our baseline simply sends the complete bounded dialogue. It has no reflection, semantic retrieval, simulated social world, or autonomous planning loop.

[Qwen's official GGUF model](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF) provides the public CPU-capable weights. [llama.cpp's server documentation](https://github.com/ggml-org/llama.cpp/blob/b11724/tools/server/README.md) defines the chat API, sampling parameters, seed, thinking-template option, and caching behavior used by the local application. The useful contribution here is the authored Bellwether scenario and an inspectable, paired continuity experiment, not a new model or memory algorithm.

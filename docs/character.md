# Speak with Ivo locally

This scene extends the original **Bellwether Ledger** world. You play Mira and speak freely with Ivo, the mechanic blamed for last winter's blackout. His [authored dossier](../characters/ivo.md) supplies history, relationships, promises, knowledge boundaries, and competing goals. A local open model generates every Ivo reply; there is no response lookup or hidden correction pass. The existing finite branching-story player remains a separate, deterministic application.

## Launch

Requires Node.js 22+, about 2.2 GB of disk for downloads, and several GB of available RAM. The default target is Linux x86-64 on a CPU, using llama.cpp **b11724 / 99db719bd** and the official **Qwen3-1.7B Q8_0** GGUF. No GPU, account, API key, or paid service is used. First-time setup needs public internet access; subsequent play is local.

From the repository root:

```sh
npm run character:setup
npm run character
```

Open **http://127.0.0.1:8787**. Try: “I have time to listen. What happened when the lamp went out?” Then make a specific promise, ask about the repair, and ask Ivo to recall the promise. Replies may take several minutes on a slow CPU. The status line reports waiting, saved replies, or errors. Ctrl+C stops the application and its model server.

Setup downloads the model and a Linux CPU runtime into ignored `.cache/` directories and verifies their SHA-256 hashes. The 1,834,426,016-byte model is pinned to Hugging Face revision `90862c4b9d2787eaed51d12237eafdfe7c5f6077`, SHA-256 `061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a`. The Linux runtime archive is pinned to `b11724`, SHA-256 `8ea5309848578510085c772dff6615167fee12888233d29508d06b81436d6678`. Neither binary nor model is distributed in this repository. Model license: Apache-2.0; llama.cpp: MIT.

On other platforms, setup downloads and verifies the same model but does not install a runtime. Build [llama.cpp at b11724](https://github.com/ggml-org/llama.cpp/tree/b11724) for your platform, then set `LLAMA_SERVER` to the executable path. That platform path has not been exercised here. `CONTINUITY_MODEL` can override the GGUF path; changing the model invalidates comparisons to the archived experiment.

To use an already running local llama.cpp server, set `CONTINUITY_MODEL_URL=http://127.0.0.1:8091` before running `npm run character`. Only HTTP loopback origins are accepted. For evaluation, also set `CONTINUITY_MODEL` to the local GGUF used by that server; its path must match the server properties so the runner can hash the selected weights. No credentials are read. Use one inference request at a time, especially during evaluation. Default launch arguments are CPU-only (`-ngl 0`), one thread, an 8192-token context, one slot, Jinja template, and context shifting disabled. Do not run two default launchers on port 8091.

## Memory and saves

Each scene has a base seed and a memory switch. With memory enabled, **all** preceding user and assistant dialogue is inserted after the dossier in chronological order. This is deliberately a simple full-history baseline, not semantic retrieval, automatic fact extraction, or an independently verified belief state. A model's mistaken statement remains visible and may influence its later statements. Commitments are authored and expressed in dialogue; the application does not enforce them mechanically.

The notebook is atomically saved as `.cache/character-session/session.json` after each successful reply. It includes the dossier hash, seed, memory condition, full requests and raw responses, finish reasons, token counts and timings. Reloading the browser or restarting the app resumes it. Failed inference does not append a turn. If the dossier has changed, the app refuses to reuse that notebook; export it before changing the dossier or choose a new directory with `CONTINUITY_SESSION_DIR`.

Use **Inspect remembered dialogue** and **Read Ivo's authored dossier** to see the context. **Export full notebook** downloads a JSON copy. **Start new scene** replaces the active notebook after confirmation; export first to retain it. To restore an export, stop the app and copy it to `session.json` in the chosen session directory, then restart with the unchanged dossier. The exported JSON is inspectable data, not authenticated evidence; manually editing dialogue changes subsequent behavior.

Memory-off still saves the notebook for inspection but sends only the dossier and latest user turn to the model. The switch takes effect on a new scene, so treatment does not change mid-conversation. Each scene is bounded to 12 turns, user messages to 1200 characters, and replies to 160 generated tokens. Very token-dense inputs can exhaust the 8192-token context sooner; the model error is surfaced instead of silently dropping old memories. There is no memory shared between distinct scenes.

Playable notebooks pin the dossier, but do not pin the selected model weights. Export and start a new scene when changing models to avoid mixing model histories. The evaluation runner separately hashes the selected weights and archives runtime provenance.

## Reproduce the evaluation

Start the local model through `npm run character` and leave it running. Do not chat while evaluating. In another terminal:

```sh
node scripts/evaluate-character.js /tmp/bellwether-evaluation
```

The output directory must not exist. This makes **32 real inference calls**. The first completed 1.7B call on the available single-CPU environment took 648 seconds for 44 generated tokens (0.099 generated tokens/second). At that rate, 32 equivalent calls would take about 5.8 hours; this is an extrapolation, not a measured full-evaluation duration. Longer replies may exceed the 15-minute per-call timeout. Faster CPU hardware is advisable.

The [fixed protocol](../characters/evaluation.json) uses two four-turn scenarios, two base seeds, and paired full-history/no-history conditions. Seed increments with turn index; settings are temperature 0.7, top-p 0.8, top-k 20, min-p 0, presence penalty 1.5, maximum 160 tokens, thinking disabled, and prompt caching disabled. Server defaults and chat template are archived separately. Fixed seeds support rerunning the experiment, but do not guarantee byte-identical output across CPU implementations, runtime builds, or concurrent workloads.

The runner checkpoints each completed turn and the manifest. It never overwrites an existing experiment or silently retries a failed turn. Failures leave a partial experiment labelled failed. Prompts, dossier, full API requests/responses, model identity and timings remain inspectable. Assess final turns using the protocol's pass/fail/unclear rubrics, and record contradictions anywhere in the transcript. Never use presence of a keyword alone as proof of continuity.

The paired evaluation is not yet complete. The [0.6B preliminary conversation](../results/character-preflight-qwen06/) contains four real memory-enabled replies, all speaking as Mira rather than Ivo; one invents a completed repair. It contains no no-memory control. The [earlier 1.7B attempt](../results/character-attempt-qwen17-timeout/) failed before its first reply. These are failed prerequisites, not evidence that the character milestone has been delivered.

The [1.7B CPU-limit attempt](../results/character-attempt-qwen17-cpu-limit/) completed two replies in 648 and 598 seconds, then timed out on the third turn after 900 seconds. Both completed replies accurately acknowledged the current report; neither tests delayed recall. The final recall probe and all control runs remain unrun. The archive includes the failed manifest, raw completed requests/responses, model provenance, and sampled runtime progress. No quality judgment is assigned to the third turn because the non-streaming API returned no completed response.

**Current blocker:** this environment exposes one available CPU and measured roughly 0.10 generated tokens/second with the pinned model. Resume the unchanged protocol on a faster authorized CPU machine; first confirm that the narrative-history turn completes within 15 minutes. The full paired experiment, real-model browser/persistence check, and final independent acceptance review are still required. Do not infer a memory benefit from this partial attempt.

A paired memory benefit is distinct from convincing characterization: a model can recall a word while speaking as the wrong person. Two seeds and two scenes cannot establish reliable narrative behavior in general. The dossier's knowledge boundaries and branching narrative's formal invariants are not guaranteed by model inference.

## Checks

```sh
node --test test/character.test.js
```

These focused application tests use a labelled fake local inference server to test persistence, request construction, failure behavior, and origin restrictions. They do **not** establish model quality. The archived preliminary conversation uses a real downloaded model. The browser test-double results do not establish that the default model can complete a playable scene.

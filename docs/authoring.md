# Authoring stories

The source of truth is one UTF-8 JSON file. Use `node src/cli.js validate your-story.json` after edits, then `build` into a new directory. Unknown fields are rejected to catch misspelled conditions and to prevent the accidental assumption that an unsupported feature runs.

## A complete small story

```json
{
  "format": 1,
  "id": "a-kept-word",
  "title": "A kept word",
  "introduction": "You are Ada. A friend has entrusted you with a letter.",
  "objective": "Decide what to do with the letter.",
  "characters": [
    {"id": "ada", "name": "Ada", "description": "Carries a letter and a promise."}
  ],
  "variables": [
    {"id": "remembered", "label": "Ada remembers the request", "type": "boolean", "initial": true, "kind": "memory", "owner": "ada"},
    {"id": "promise", "label": "Letter promise", "type": "enum", "values": ["unmade", "promised", "kept", "broken"], "initial": "promised", "kind": "commitment", "owner": "ada"},
    {"id": "delivered", "label": "Letter delivered", "type": "boolean", "initial": false}
  ],
  "start": "door",
  "scenes": [
    {
      "id": "door", "title": "At the door", "text": "The letter is still sealed.",
      "choices": [
        {
          "id": "deliver", "text": "Deliver it as promised.", "to": "home",
          "when": {"var": "remembered", "op": "eq", "value": true},
          "effects": [{"var": "delivered", "value": true}, {"var": "promise", "value": "kept"}]
        }
      ]
    },
    {"id": "home", "title": "Home", "text": "The letter is where it belongs.", "ending": true, "choices": []}
  ],
  "invariants": [
    {
      "id": "kept_means_delivered",
      "message": "A kept promise must have a delivered letter.",
      "when": {"var": "promise", "op": "eq", "value": "kept"},
      "assert": {"var": "delivered", "op": "eq", "value": true}
    }
  ]
}
```

Save that block as `letter.json`. Validation and checking should exit 0. It has a single ending, which is allowed for your own stories; the included original story has three.

## Fields

The top-level fields in the example are all required. Format version is exactly `1`. IDs use `[a-z][a-z0-9_-]{0,47}`. Character, variable, scene, and invariant IDs must be unique within their collection. Choice IDs must be **globally** unique, even across scenes. Keep IDs stable while editing; human-facing text can change independently, although **any changed source bytes invalidate saves**.

Characters have `id`, `name`, and `description`. A variable has `id`, `label`, `type`, and `initial`, plus:

| Type or annotation | Additional fields and meaning |
| --- | --- |
| `boolean` | Exactly `true` or `false`. |
| `integer` | Required inclusive `min` and `max`, at most 32 distinct safe integers. |
| `enum` | Required `values`, 1–32 unique nonempty strings, at most 80 characters each. |
| `kind: "fact"` | Optional descriptive annotation; default fields need no kind. |
| `kind: "memory"` | A boolean with required `owner`, referencing a character. |
| `kind: "commitment"` | An enum with exactly `["unmade", "promised", "kept", "broken"]` in that order, and a required `owner`. |
| `owner` | Optional for other variables; always a valid character ID. |

Memories are not automatically permanent, and commitments do not automatically progress in one direction. Encode what matters with conditions and invariants. For example, a promise can be marked `broken` honestly; your invariant should describe the contradiction you intend to prohibit, rather than assume that every character always keeps every promise.

Scenes have `id`, `title`, `text`, `choices`, optional boolean `ending`, and optional `lines`. An ending must have no choices. A nonterminal scene with no available choices is legal input but a search finding. All scene text is plain text, with blank lines forming paragraphs.

Conditional prose can be added without changing state:

```json
"lines": [
  {
    "when": {"var": "remembered", "op": "eq", "value": true},
    "text": "You can still hear the request exactly as it was spoken."
  }
]
```

Choices have `id`, `text`, `to`, `effects`, and optional `when`. Missing `when` means `true`. An effect is `{ "var": "delivered", "value": true }`: it assigns a constant in the declared domain. Assign each variable at most once per choice. All assignments happen together, then the destination scene is entered. There are no automatic entry or exit effects.

## Conditions and invariants

Conditions are booleans or these objects:

```json
{"var": "delivered", "op": "eq", "value": true}
{"not": {"var": "delivered", "op": "eq", "value": true}}
{"all": [{"var": "remembered", "op": "eq", "value": true}, {"scene": "door"}]}
{"any": [{"scene": "door"}, {"scene": "home"}]}
```

`eq` and `ne` compare any declared type. `lt`, `le`, `gt`, and `ge` require integers. Comparison values must belong to the variable's domain. `all` and `any` require at least one child. `not` takes one child. Scene tests refer to existing scene IDs. No cross-variable comparisons, arbitrary expressions, or string interpolation are supported.

An invariant has `id`, `message`, `assert`, and optional `when`. It fails when `when` holds and `assert` does not. It is checked at the initial state and after transitions, subject to search budgets. It never blocks play or prunes exploration. The player displays observed violations as continuity warnings.

## Repairing the supplied contradiction

In `stories/broken-promise.json`, `pledge` makes `promise = true`; `publish` then sets `named = true`. The `withheld` invariant disallows those facts together. The shortest witness is `pledge`, `publish`.

1. Export and open the author report. Select `withheld` and press **Next step** twice. The first step changes the promise; the second changes the publication fact.
2. Change the publication action so that a promise is honored, or make an explicit new story path that releases the promise before publication. Merely adding an unavailable guard to `publish` leaves a cycle with no route to an ending: a checker for safety alone will not establish that this is good design.
3. One simple repair changes the publication choice text to “Withhold it as promised” and its assignment to `named = false`. The contradiction disappears. The deliberately unreachable scenes in the fixture remain; remove them or add meaningful routes if you want a fully clean check.
4. Export to a new directory and replay the changed path. Old saves are intentionally incompatible with the edited file.

The `scenes` report view includes shortest observed routes to every reachable scene. The `states` view separates different memories or commitments at the same scene. `findings` includes each observed violating state/invariant pair and each nonterminal dead end, plus unreachable scenes only if the search was exhaustive. Use page navigation to reach every entry; no finding is hidden behind a fixed total-row truncation.

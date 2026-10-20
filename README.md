# todo-app

A todo app that answers one question: **what's the most useful thing I could be doing right now?**

It does the usual things. Tasks have notes, optional due dates, and can depend on other tasks. What's different is that you never give a task a priority number. The app works out priority from quick questions that take a few seconds each, like *"Which matters more: A or B?"*, and then combines that with what you can actually do right now: how much time you have, where you are, and what's blocked.

## The problem

Ranking tasks is hard because:

- **People are bad at giving things absolute scores.** Is "call the dentist" a 6 or a 7? Nobody knows, and the answer changes depending on your mood. People are much better at relative judgments like "this one matters more than that one."
- **Importance isn't the same as doability.** The most important task is useless to suggest if it needs a car and you have 10 minutes at your desk.
- **Tasks depend on each other.** A dull task that blocks three important ones is itself important.
- **Priorities change.** What mattered most last month may not matter now. Deadlines get closer and circumstances change.

## Core idea: three separate concerns

The app keeps three things apart instead of folding them into one "priority" field:

| Concern | Question it answers | Where it comes from | How fast it changes |
|---|---|---|---|
| **Importance** | How much does this matter? | Learned from pairwise questions | Slowly |
| **Urgency** | How soon does it matter? | Due dates, plus the time each task needs | Continuously, as time passes |
| **Feasibility** | Can I do it *right now*? | Dependencies, context (time, location, energy) | Moment to moment |

The recommendation comes from:

1. **Filter** to tasks that can be done now: not blocked, fit in the time available, possible at the current location.
2. **Override** for any deadline that's about to be missed.
3. **Find the candidates:** tasks that no other task beats on every dimension at once (see [Combining dimensions](#combining-dimensions)).
4. **Ask** "which first?" questions until one candidate is left, then suggest it.

### Two different orderings

There are two partial orders here. They're easy to mix up, so they're kept separate:

- **Dependency order** (`A → B`: A must be done before B). These are hard constraints that the user enters directly. The graph must have no cycles.
- **Importance order** (`A ≤ B`: A matters no more than B, so do B first). This is a soft preference, learned from questions.

They interact in one way: **a task is at least as important as anything it blocks.** If A blocks B and B is important, A gets B's importance. The app enforces this when computing rankings. You never have to state it.

## Combining dimensions

There's no weighted sum here. Weights are just priority numbers under another name, and people are no better at choosing those. The dimensions are combined in layers instead. Each layer is either a hard rule or another partial order, and the user is asked only where dimensions actually conflict.

### Layer 1: Hard filters (not ranked)

Things that can't happen right now are removed, not ranked lower:

- blocked by an unfinished dependency
- `duration_estimate` doesn't fit the time available
- needs a context the user isn't in (place, tools, energy)

### Layer 2: Deadline override

Urgency is measured as **slack**: how many future chances to do the task are left before its deadline. A chance is a block of time, in a context where the task is possible, that's long enough to do it. Wall-clock time isn't enough. A task due in 3 days that needs a 3-hour block is in trouble if you only get one of those a week.

- If slack is about to run out (this is the last chance, or close to it), the task goes **before everything else**, ordered by earliest deadline. The app still confirms: *"B is due tomorrow and this is your last chance. Do it now?"*
- Otherwise, urgency is treated as one more dimension in the next layer.

This override is the only fixed rule between dimensions. It exists because missing a deadline can't be undone, and other mistakes can.

### Layer 3: Dimensions as a product order

Each remaining dimension orders tasks on its own:

| Dimension | Meaning | Source |
|---|---|---|
| **Effective importance** | How much it matters, including what it unblocks | Pairwise questions |
| **Urgency** | How little slack is left | Due dates, durations, context history |
| **Scarcity** | How rare this kind of chance is | Context history |

**Scarcity** is the dimension people tend to forget. If you're at the hardware store or have a free afternoon, and that rarely happens, do the tasks that need it now, even if something at your desk matters slightly more. The desk task will get another chance. The same idea runs the other way: don't spend a rare free hour on 5-minute tasks that could fill any short gap.

Combine the dimensions with the **product order**: A beats B only if A is at least as good as B on *every* dimension, and strictly better on at least one. The result is still a partial order, so everything in [A session](#a-session) still applies. The candidates are the tasks that nothing beats on every dimension, often called the **Pareto front**. If the front has one task, it's suggested with no questions asked.

### Layer 4: "Which first?" questions on the front

When the front has more than one task, the dimensions conflict: A matters more, but B is more urgent or the chance is rarer. Only the user can trade those off, so the app asks:

> *Right now: A or B?*

These answers are different from importance answers:

- **They apply only to this moment.** They're not added to the importance order, because the answer depends on today's slack and context.
- **They're used to learn your trade-offs.** Each answer is a data point: "with this gap in importance, this much slack, and this scarcity, the user picked B." Fit a small model to these, such as logistic regression on the differences between the two tasks on each dimension. Once the model confidently predicts a pair, the app settles it without asking. Over time, the front shrinks and sessions get shorter.
- **Your choices count too.** Doing D when the app suggested A is a "which first?" answer, and the app uses it the same way.

So the app never needs weights from the user. It works out the weights from the choices the user makes.

## Learning importance through quick questions

### Rules for questions

Each question should:

- Be answerable in **under 5 seconds**, with one tap.
- **Never ask something already implied.** If you said A > B and B > C, the app never asks about A vs C.
- **Never produce a contradiction.** The app only asks about pairs whose order isn't already implied. Either answer to such a question keeps the order acyclic (antisymmetric and transitive), so no answer can cause a cycle.
- **Include an "I can't compare these" option.** Some tasks really are incomparable, and a partial order allows for that. Forcing an answer just adds noise.

### A session

When you ask "what should I do?", a short round of questions runs (around 30 seconds, but the length isn't fixed). Then the app hands you a task.

1. **Filter** to the tasks that can be done now (see [Context](#context)), and apply the [deadline override](#layer-2-deadline-override).
2. **Find the maximal elements** of the [combined order](#layer-3-dimensions-as-a-product-order). These are the candidates: feasible tasks that no other feasible task beats.
3. **Ask questions until there's one candidate left, or the time is up.** Each question compares two candidates.
4. **Recommend** a remaining candidate. If several are left, use the learned trade-off model to pick the one it most expects you to choose.

Every candidate is a reasonable choice, because no feasible task is known to matter more. The questions just narrow the choice down.

A note on terms: the set of tasks is a partial order, not usually a lattice. A set of tasks often has no least upper bound, since two tasks can both be "top" with nothing above them. So the goal is to **reduce the set of maximal elements to one**. Once there's only one, it is the greatest element, which is the supremum.

### Choosing which question to ask

Only questions that compare **two current candidates** are useful:

- **Each question removes exactly one candidate.** If A beats B, then B is no longer maximal. Nothing new becomes maximal either, because anything below B is now also below A. So going from `m` candidates to 1 takes exactly `m − 1` questions. No strategy can do better, because every candidate except the winner has to lose at least once.
- **No question can be redundant.** Two candidates are never already ordered relative to each other, or one of them wouldn't be a candidate.
- **Use brackets, not king-of-the-hill.** The total for this session is the same either way, but the *next* session depends on the shape. Once you finish the top task, the new candidates are the tasks it beat directly (unless something else beats them too). If one task beat everything in turn, finishing it frees all of them at once. With a balanced bracket (pair the candidates off, then pair the winners, and so on), the winner beat only about `log₂ m` tasks directly, so the next session needs only about `log₂ m` questions. This is the tournament-tree idea behind heap sort.
- **Adding a task costs at most one question.** A new task hasn't been compared with anything, so it starts out as a candidate. One comparison against the current top decides whether it becomes the new top.
- **Cost of a session.** At roughly 2–3 seconds per question, 30 seconds is about 10–15 questions. That's enough to get down to one candidate from about a dozen. If time runs out first, every candidate left is still a valid answer.

Questions about other kinds of task information (duration, location, dependencies) can share the same time, and go first when they would change which tasks are feasible.

### Inconsistency

If the app only ever asks about unordered pairs, a contradiction **can't happen**, and it **can't be detected** either. Problems come in only when the user's real preferences differ from what's stored, because of a careless tap or a change of mind. To catch this, the app has to ask **check questions** on purpose: now and then it asks about a pair that is already ordered.

- If the answer agrees with what's stored, that ordering becomes more trusted.
- If the answer contradicts it, there's now a cycle. The app finds the cycle and asks about one stored answer in it, starting with the oldest (it's the most likely to be out of date). The order is valid again once enough stored answers have been overridden to remove every cycle. (Finding the smallest such set is NP-hard in general, but the cycles here will be small.)
- Check questions should focus on orderings that decide the current candidates, because a mistake there changes what you're told to do.

### Detecting drift

The order alone can't prove that it's wrong. It can only show *where it's most likely to be wrong*. Only new evidence (a check question, or what the user actually does) can confirm it. The signals below point to the orderings most worth checking.

**Structural signals (from the order itself):**

- **Old answers that a lot depends on.** Some stored answers imply many orderings through transitivity. In the Hasse diagram, these are the edges that many paths run through. Suspicion is roughly *age × number of orderings it implies*.
- **Long chains of inference.** An implied `A > Z` that rests on a chain of `k` answers is only as fresh as the oldest answer in the chain. It was never asked about directly.
- **Trapped tasks.** Candidates are only compared with each other, so a task beaten by an overrated top task is never asked about again until that top task is done. One stale answer can bury a whole group of tasks. Fix this with *challenge questions*: re-ask a buried task against the task that beat it, starting with the oldest such answer.
- **Dependency conflicts.** You said `C > A`, but A blocks B and you said `B > C`. The rule that a task is at least as important as what it blocks then implies `A > C`, which contradicts what you said. Either the direct answer is out of date, or the dependency is.
- **Tasks that always lose.** A task that loses every comparison may not be worth doing at all. Ask *"Still relevant?"*
- **New tasks keep winning.** If newly added tasks keep beating a long-standing top task, the old top is probably overrated. (Or the user favors whatever is new, which is worth knowing too.)

**Answer signals:**

- **Contradictions grouped around one task.** If they all involve the same task, that task's value has changed. If they're spread out, it's just noise.
- **Slow answers.** Answer time is free information. A slow answer means a close call, so trust it less and expect it to flip.
- **More "can't compare" answers.** If this keeps happening for one task, it's probably vague and needs splitting or rewording.

**Behavior signals (outside the order):**

- **The user does something else.** If the app suggests A and you finish D instead, that is direct evidence that `D > A`, at least in that context. This is the strongest signal there is.
- **Repeatedly skipped suggestions.** Either the task is overrated, or it isn't really doable now and some context is missing.
- **Changes nearby.** Finishing, adding, or editing a task can change the value of related tasks (ones that stand in for each other or go together). Comparisons near the change should count as more out of date.

**Putting it together:** give each stored answer a confidence that decays from the time it was last asked or confirmed, rises with confirmations, and falls with conflicts. Decay should depend mostly on how much has changed since then (tasks done, added, or edited, especially nearby ones), with elapsed time as a minimum rate. It should also be scaled by how volatile the two tasks are. How long a task has sat in the list is a separate signal, used to ask "still relevant?", not to decay confidence. An implied ordering is as confident as its best supporting path. Spend check questions where confidence is low **and** the ordering affects the current candidates.

### Handling mistakes and drift

Strict transitivity has a weakness: one careless tap gets locked in forever, and so does everything implied by it. Two ways to handle this (see [open questions](#open-questions)):

1. **Strict partial order.** Store the order directly and let users undo or revisit an answer.
2. **Probabilistic model (preferred).** Store each answer as *evidence*, not as fact. Fit a model with uncertainty, such as Bradley–Terry or TrueSkill, and treat `A < B` as holding once confidence is high enough. Old answers gradually count for less, so priorities can change. Occasionally re-ask an old comparison to check it. Contradictory answers don't break anything, they just raise the uncertainty, and the app asks about those tasks again.

Either way, **store the raw answers and compute the order from them.** Never store a computed priority as the source of truth.

## Question types

Every bit of task metadata should be collectable through a quick question. Nothing should need a form.

| Question | Purpose |
|---|---|
| *Which matters more: A or B?* | Importance |
| *Can A be done in under 15 minutes?* / *Under an hour?* | Duration estimate (coarse buckets, by binary search) |
| *Do you need to be somewhere specific for A?* → *Where?* | Location / context |
| *Does A need anything else done first?* | Dependencies |
| *Is A still relevant?* | Removing stale tasks |
| *Would it be bad if A slipped past Friday?* | Soft deadlines without exact dates |
| *Did you actually do the thing I suggested?* | Feedback on the recommender |

## Context

When you ask "what should I do?", the app needs to know your situation. Ideally it infers this, and asks only when it has to:

- **Time available.** "I've got 10 minutes" / "an hour" / "the afternoon". This could be inferred from the gap until your next calendar event.
- **Location.** Home / work / out / anywhere. This could come from device location, matched to named places.
- **Energy** (optional). Sharp / tired. Some tasks need focus, some don't.

## Graph model

There is one set of task nodes and several kinds of edges. Each kind has its own rules. The key split is between **evidence edges** (stored, append-only, and allowed to contradict each other) and **belief edges** (computed from the evidence, and required to form a valid order).

```
                    ┌────────── REQUIRES ──────────► (Context: hardware store)
                    │
   (Task A) ──DEPENDS_ON──► (Task B)
      ▲  ╲                     │
      │   ╲ PREFERRED_OVER ×3  │ PREFERRED_OVER ×1
      │    ╲ (2 say C>A,       ▼
      │     ╲  1 says A>C)  (Task C)
      │      ╲
      └── CHOSEN_OVER (moment-scoped) ── (Task D)

   derived:  IMPORTANCE   =  resolve(PREFERRED_OVER)           must be a DAG
             EFFECTIVE    =  IMPORTANCE ∪ reverse(DEPENDS_ON)   must be a DAG; a cycle = conflict
             DOMINATES    =  product order on the feasible subgraph, per session
```

### Edge types

| Edge | Between | Kind | Rules | Notes |
|---|---|---|---|---|
| `DEPENDS_ON` | Task → Task | stored, hard | Must form a DAG. Inserts that would create a cycle are rejected. | Entered by the user. |
| `PREFERRED_OVER` | Task → Task | stored evidence | Several edges per pair are allowed, and contradictions are allowed. | One edge per answer: `answered_at`, `latency`, `kind`, `context`. |
| `INCOMPARABLE` | Task — Task | stored evidence | Undirected. | Stops the app from asking that pair again soon. |
| `CHOSEN_OVER` | Task → Task | stored evidence | Not transitive. Cycles are fine. | "Which first?" answers and behavior. Used only to train the trade-off model. |
| `REQUIRES` | Task → Context | stored, hard | A task needs *all* of its required contexts. | Place, tools, energy. Duration is a task attribute, not an edge. |
| `IMPORTANCE` | Task → Task | derived | DAG, kept as its transitive reduction (Hasse edges only). | Each edge carries a `confidence`, plus a link back to the evidence that supports it. |
| `EFFECTIVE` | Task → Task | derived | Must be a DAG. | `IMPORTANCE` plus a reversed `DEPENDS_ON` edge (a blocker is at least as important as what it blocks). |
| `DOMINATES` | Task → Task | derived, per session | Only among feasible tasks. | The product order of importance, urgency and scarcity. |

### Why the evidence is kept separate from the beliefs

- **Contradictions are data, not corruption.** Two answers in opposite directions on the same pair are both stored. When the app computes `IMPORTANCE`, it weighs them by confidence (age, volatility, latency) and keeps the winner, or drops the edge if neither is convincing.
- **Every belief can be traced back.** Each `IMPORTANCE` edge points back to the answers behind it, which is how "old answers that a lot depends on" and "trapped tasks" are found.
- **Rules are enforced on the computed edges only.** Only `DEPENDS_ON` and the computed edges have to stay acyclic. The evidence never has to.

### What the drift signals look like in the graph

| Signal | In the graph |
|---|---|
| Candidates | Feasible tasks with no incoming `DOMINATES` edge |
| Old answers that a lot depends on | `IMPORTANCE` edges that many reachability pairs pass through, weighted by the age of their evidence |
| Long inference chains | Pairs connected only by long paths with no direct evidence |
| Trapped tasks | Nodes whose incoming `IMPORTANCE` edges all have low confidence |
| Dependency conflicts | A cycle in `EFFECTIVE`. One edge in it comes from `DEPENDS_ON` and the rest from `IMPORTANCE`. |
| Contradictions grouped around one task | `PREFERRED_OVER` edges in both directions, concentrated on one node |
| Nearby changes | Graph distance from a task that was just finished or edited |

### What isn't in the graph

Context history (`ContextLog`) is a time series, not relationships between nodes, so it lives in a plain table. Slack and scarcity are computed from it and attached to task nodes as attributes.

### Storage

A personal task list is hundreds of nodes, not millions, so a graph database would be overkill. Only the stored records are saved. Everything derived is recomputed in memory after every change and never saved. See [Persistence](#persistence) for how the app does this.

## Data model (draft)

Stored values are the source of truth. Derived values are recomputed from them and never edited directly.

```
Task                                  # stored: what the user has told us
  id, title, notes
  created_at: datetime
  due?: datetime                      # hard deadline
  soft_due?: datetime                 # from "would it be bad if it slipped past X?"
  duration_estimate?: bucket          # 5m, 15m, 1h, half-day, ...
  contexts: set<Context>              # where/with what it can be done
  energy?: focused | any              # optional
  depends_on: set<TaskId>             # must form a DAG
  status: open | done | dropped

Comparison                            # stored: raw evidence, append-only
  a, b: TaskId
  result: a_more | b_more | incomparable
  answered_at: datetime
  latency: duration                   # slow answer = close call
  kind: initial | check | challenge
  context?: Context                   # where the user was when answering

Suggestion                            # stored: what the user did with a recommendation
  task: TaskId
  at: datetime
  outcome: done | skipped | did_other(TaskId)

Tradeoff                              # stored: "which first?" answers, append-only
  chosen, other: TaskId
  at: datetime
  features: {d_importance, d_slack, d_scarcity}   # differences at the time of asking
  source: question | behavior

Context
  name, (optional) location geofence

ContextLog                            # stored: when/where/how long the user was free
  context: Context
  start, end: datetime

# Derived, recomputed per session
Task (derived)
  importance                          # position in the order, from Comparisons
  effective_importance                # max(own, tasks it blocks, transitively)
  slack                               # expected chances left before due/soft_due,
                                      # from ContextLog and duration_estimate
  scarcity                            # how rarely a chance like this one comes up
  feasible_now: bool                  # unblocked, fits time, matches context
  volatility                          # how often its comparisons get overturned
  times_suggested, times_skipped      # from Suggestions

Comparison (derived)
  confidence                          # decays with events since answered_at,
                                      # scaled by volatility of a and b;
                                      # rises on confirmation, falls on conflict
```

## Running it

The app is a PWA (an installable web app) built with Vite, TypeScript and Preact.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # core logic and persistence tests
npm run build      # production build in dist/
npm run preview    # serve dist/ (service worker and install work here)
```

To use it on an Android phone, serve `dist/` over HTTPS (GitHub Pages, Netlify, Cloudflare Pages and similar all work), open it in Chrome and choose **Install app**. It then opens full screen from the home screen and works offline. To try it on a phone over your local network without HTTPS, use `chrome://inspect` port forwarding to the dev server. Chrome only allows service workers on `localhost` or HTTPS.

### Code layout

| Path | What |
|---|---|
| `src/core/` | The ranking logic: confidence decay, the graph and its cycle handling, feasibility, slack and scarcity, the trade-off model, and `engine.ts`, which decides the next question or suggestion. No UI or storage code, so it can be tested on its own. |
| `src/store/` | Persistence (see below). |
| `src/ui/` | Screens: task list, task editor, situation picker, session (questions, suggestion, "can't do it" follow-ups), settings. |
| `public/` | Manifest, service worker, icons. `scripts/make-icons.py` regenerates the PNG icons. |

### Persistence

All data stays on the device, in **IndexedDB**, the browser's built-in database.

- **One object store per record type:** `tasks`, `comparisons`, `tradeoffs`, `suggestions`, `contexts`, `contextLogs`, plus `meta` for small settings such as the last situation used. These are the stored records from the [data model](#data-model-draft). Comparisons, trade-offs, suggestions and context logs are append-only.
- **Memory first, then disk.** On startup the app loads everything into memory, because a personal task list is small. Each change updates memory and the screen immediately, then writes that one record to IndexedDB in the background. Writes are queued in order. A failed write is shown in Settings.
- **Nothing derived is saved.** The importance graph, confidence values, candidates and the trade-off model are rebuilt from the stored records whenever data changes. This is cheap at this size, and it means the stored records are the only thing that matters, which makes changing the algorithm safe.
- **Protection from eviction.** Browsers may clear site data when the device runs low on space. The app calls `navigator.storage.persist()`, which Chrome grants to installed apps, and Settings shows whether it was granted.
- **Backups.** Uninstalling the app or clearing site data deletes everything, so Settings can export all records as one JSON file and restore from one. Syncing between devices would also build on this format, since every record has a unique id and the evidence records are append-only.

Why IndexedDB rather than SQLite: SQLite in the browser needs a WebAssembly build plus the Origin Private File System, which adds weight and setup. Nothing here needs SQL, because all the querying happens in memory. If the app is later wrapped with Capacitor, the `src/store/` layer can be swapped for native SQLite without touching `src/core/`.

### What's implemented

- Tasks with notes, hard and soft due dates, duration, required contexts, energy, and dependencies (cycles are rejected).
- Sessions: pick your time, place and energy, answer questions for about 30 seconds, then get a suggestion with reasons.
- Candidates are the feasible tasks nothing beats on importance, urgency and scarcity together. Questions pair them up like a bracket. Importance answers are stored as evidence, and "which first?" answers count only for the current session but train the trade-off model, which answers on its own once it's confident.
- Deadline override, check questions for contradicted answers, and challenge questions for weak answers that bury a task.
- Done, skip, "can't do it" with each reason updating the task (blocker, duration, context, a missing thing as a new blocker task, energy, drop or re-rank), and "I did something else".

Not yet: calendar or location-based context, notifications, sync, and recurring tasks.

## Open questions

- **Strict vs probabilistic importance.** A strict order is simpler and easier to explain. A probabilistic model handles human noise and drift. I'm leaning probabilistic, but showing an order to the user may be enough either way.
- **Cold start for slack and scarcity.** Both need a history of when and where the user was free. Until there's enough of it, the app falls back to wall-clock time until the deadline and treats every context as equally common. It could also read the calendar.
- **How close to "last chance"** should the deadline override kick in? There could be a fixed safety margin (e.g. 2 chances left), or one that depends on importance.
- **Ties among top tasks.** If the top candidates can't be compared, suggest all of them? Choose at random? Ask a tie-break question right then?
- **How many questions per day** before it becomes a chore? Questions could be offered in idle moments, such as a notification or widget, instead of up front.
- **Recurring tasks.** Does a recurring task keep its comparisons from one occurrence to the next?
- **Large tasks.** Should tasks bigger than some size have to be split into subtasks, so they fit into the time you actually have?

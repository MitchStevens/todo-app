import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  buildPlan,
  continueSession,
  features,
  newSession,
  nextStep,
  recordAsked,
  recordWin,
  type Plan,
  type Question,
  type Session,
  type Step,
} from '../core/engine';
import { infeasibility, type Infeasible } from '../core/situation';
import { DURATIONS, type Id, type Situation, type Task } from '../core/types';
import type { Repo } from '../store/repo';
import type { Navigate } from './App';
import { formatAge, formatDuration, reasonText, situationText, taskMeta } from './format';
import { useRepo } from './hooks';
import { BackIcon, CloseIcon } from './icons';
import { ContextChips } from './SituationPicker';

type Mode =
  | { name: 'step' }
  | { name: 'cant'; task: Id }
  | { name: 'blocker'; task: Id }
  | { name: 'duration'; task: Id }
  | { name: 'context'; task: Id }
  | { name: 'missing'; task: Id }
  | { name: 'not-worth'; task: Id }
  | { name: 'other-reason'; task: Id }
  | { name: 'did-other'; task: Id };

export function SessionView({ situation, go }: { situation: Situation; go: Navigate }) {
  const repo = useRepo();
  const session = useRef<Session>(newSession(Date.now()));
  const [mode, setMode] = useState<Mode>({ name: 'step' });
  // Bumped whenever the session changes without the data changing.
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);

  const plan = useMemo(() => buildPlan(repo.data, situation, Date.now()), [repo.data, situation]);
  const step = useMemo(() => nextStep(plan, session.current, Date.now()), [plan, tick]);

  /** After acting on a suggestion: back to the next candidate. */
  const next = () => {
    continueSession(session.current, Date.now());
    setMode({ name: 'step' });
    refresh();
  };
  /** The user can't (or won't) do this task now: log why, and move on. */
  const cant = (task: Id, reason: string, outcome: 'cant' | 'skipped' = 'cant') => {
    repo.addSuggestion({ task, outcome, reason });
    session.current.excluded.add(task);
    next();
  };
  const close = () => go({ name: 'list' });
  const ctx = { repo, plan, situation, setMode, cant, next };

  switch (mode.name) {
    case 'step':
      return (
        <StepView
          step={step}
          {...ctx}
          session={session.current}
          refresh={refresh}
          close={close}
          changeSituation={() => go({ name: 'situation' })}
        />
      );
    case 'cant':
      return <CantDo task={repo.task(mode.task)!} {...ctx} />;
    case 'blocker':
      return <BlockerPicker task={repo.task(mode.task)!} {...ctx} />;
    case 'duration':
      return <DurationPicker task={repo.task(mode.task)!} {...ctx} />;
    case 'context':
      return <ContextNeeded task={repo.task(mode.task)!} {...ctx} />;
    case 'missing':
      return <MissingThing task={repo.task(mode.task)!} {...ctx} />;
    case 'not-worth':
      return <NotWorth task={repo.task(mode.task)!} {...ctx} />;
    case 'other-reason':
      return <OtherReason task={repo.task(mode.task)!} {...ctx} />;
    case 'did-other':
      return <DidOther task={repo.task(mode.task)!} {...ctx} />;
  }
}

interface Ctx {
  repo: Repo;
  plan: Plan;
  situation: Situation;
  setMode: (m: Mode) => void;
  cant: (task: Id, reason: string, outcome?: 'cant' | 'skipped') => void;
  next: () => void;
}

function StepView(
  props: Ctx & { step: Step; session: Session; refresh: () => void; close: () => void; changeSituation: () => void },
) {
  const { step } = props;
  if (step.type === 'question') return <QuestionView {...props} question={step.question} candidates={step.candidates} />;
  if (step.type === 'suggest') return <SuggestView {...props} taskId={step.task} step={step} />;
  return <NothingFits {...props} />;
}

// Questions

function QuestionView({
  repo,
  plan,
  situation,
  session,
  question: q,
  candidates,
  refresh,
  close,
}: Ctx & { session: Session; question: Question; candidates: Id[]; refresh: () => void; close: () => void }) {
  const shownAt = useRef(Date.now());
  const key = `${q.type}:${q.a}:${q.b}`;
  useEffect(() => {
    shownAt.current = Date.now();
  }, [key]);

  // Time left, redrawn twice a second.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, 1 - (now - session.startedAt) / session.budgetMs);

  const a = plan.byId.get(q.a)!;
  const b = plan.byId.get(q.b)!;

  const pick = (winner: Id) => {
    const loser = winner === q.a ? q.b : q.a;
    const latencyMs = Date.now() - shownAt.current;
    if (q.type === 'importance') {
      repo.addComparison({
        a: q.a,
        b: q.b,
        result: winner === q.a ? 'a' : 'b',
        latencyMs,
        kind: q.kind,
        contexts: situation.contexts,
      });
      recordAsked(session, q, winner);
    } else {
      const diff = winner === q.a ? q.features : q.features.map((x) => -x);
      repo.addTradeoff({ chosen: winner, other: loser, features: diff, source: 'question' });
      recordAsked(session, q);
      recordWin(session, winner, loser);
    }
    refresh();
  };
  const cantCompare = () => {
    repo.addComparison({
      a: q.a,
      b: q.b,
      result: 'incomparable',
      latencyMs: Date.now() - shownAt.current,
      kind: q.type === 'importance' ? q.kind : 'initial',
      contexts: situation.contexts,
    });
    recordAsked(session, q);
    refresh();
  };
  const skip = () => {
    recordAsked(session, q);
    refresh();
  };
  const suggestNow = () => {
    session.stopRequested = true;
    refresh();
  };

  const prompt = q.type === 'importance' ? 'Which matters more?' : 'Right now: which first?';
  const header =
    q.type === 'importance' && q.kind !== 'initial'
      ? 'Checking an earlier answer'
      : `Your top ${candidates.length} for ${situationText(situation, repo.data.contexts)}`;

  return (
    <main class="screen flush" style="height:100dvh">
      <div class="bar pad">
        <button class="icon-btn" aria-label="Close" onClick={close}>
          <CloseIcon />
        </button>
        <div class="progress" role="progressbar" aria-label="Time left" aria-valuenow={Math.round(left * 100)}>
          <div style={{ width: `${left * 100}%` }} />
        </div>
        <button class="btn link" style="color:inherit;font-weight:600;text-decoration:none" onClick={suggestNow}>
          Suggest now
        </button>
      </div>
      <div class="bar pad" style="min-height:0;padding-top:0">
        <span class="muted small">{header}</span>
        <span class="muted small">Question {session.asked + 1}</span>
      </div>

      <div class="halves grow" style="display:flex;flex-direction:column;min-height:0">
        <TaskHalf task={a} plan={plan} repo={repo} alt onPick={() => pick(q.a)} />
        <div class="strip">
          <strong>{prompt}</strong>
          {q.type === 'importance' ? (
            <button class="chip" onClick={cantCompare}>
              Can't compare
            </button>
          ) : (
            <button class="chip" onClick={skip}>
              Either
            </button>
          )}
        </div>
        <TaskHalf task={b} plan={plan} repo={repo} onPick={() => pick(q.b)} />
      </div>

      <div class="bar pad" style="border-top:1px solid var(--line)">
        <span class="muted small">{q.type === 'tradeoff' ? 'Only counts for now' : ''}</span>
        <button class="btn link" onClick={skip}>
          Skip question
        </button>
      </div>
    </main>
  );
}

function TaskHalf({
  task,
  plan,
  repo,
  alt,
  onPick,
}: {
  task: Task;
  plan: Plan;
  repo: Repo;
  alt?: boolean;
  onPick: () => void;
}) {
  const blocks = repo.data.tasks.filter((o) => o.status === 'open' && o.dependsOn.includes(task.id));
  const skips = plan.skips.get(task.id) ?? 0;
  const note = task.notes.split('\n')[0];
  return (
    <button class={`half${alt ? ' alt' : ''}`} onClick={onPick}>
      <span class="title">{task.title}</span>
      <span class="muted small">{taskMeta(task, repo.data.contexts, plan.now)}</span>
      {blocks.length > 0 && <span class="small">Blocks: {blocks.map((o) => o.title).join(', ')}</span>}
      {note && <span class="note">“{note}”</span>}
      <span class="muted" style="font-size:13px">
        Added {formatAge(task.createdAt, plan.now)}
        {skips > 0 ? ` · skipped ${skips === 1 ? 'once' : `${skips} times`}` : ''}
      </span>
    </button>
  );
}

// Suggestion

function SuggestView({
  repo,
  plan,
  situation,
  step,
  taskId,
  session,
  setMode,
  next,
  close,
}: Ctx & { step: Extract<Step, { type: 'suggest' }>; taskId: Id; session: Session; close: () => void }) {
  const t = plan.byId.get(taskId)!;
  const done = () => {
    repo.setStatus(t.id, 'done');
    repo.addSuggestion({ task: t.id, outcome: 'done' });
    next();
  };
  const skip = () => {
    repo.addSuggestion({ task: t.id, outcome: 'skipped' });
    session.excluded.add(t.id);
    next();
  };
  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Close" onClick={close}>
          <CloseIcon />
        </button>
        <span class="muted small">{situationText(situation, repo.data.contexts)}</span>
      </div>
      <h2 style="margin-top:12px">{step.override ? 'Deadline: do this now' : 'Do this now'}</h2>
      <h1>{t.title}</h1>
      <div class="muted">{taskMeta(t, repo.data.contexts, plan.now)}</div>
      <div class="box">
        <strong>Why this one</strong>
        {step.reasons.map((r, i) => (
          <div key={i}>{reasonText(r, plan.now)}</div>
        ))}
      </div>
      {t.notes && (
        <div class="field">
          <strong>Notes</strong>
          <div class="muted" style="white-space:pre-wrap">
            {t.notes}
          </div>
        </div>
      )}
      <div class="grow" />
      <button class="btn primary block" onClick={done}>
        Mark done
      </button>
      <div class="row2">
        <button class="btn" onClick={skip}>
          Skip
        </button>
        <button class="btn" onClick={() => setMode({ name: 'cant', task: t.id })}>
          Can't do it…
        </button>
      </div>
      <button class="btn link" onClick={() => setMode({ name: 'did-other', task: t.id })}>
        I did something else
      </button>
    </main>
  );
}

const INFEASIBLE_TEXT: Record<Infeasible, string> = {
  blocked: 'waiting on another task',
  too_long: 'take longer than you have',
  context: 'need somewhere or something else',
  energy: 'need more energy',
  closed: 'closed',
};

function NothingFits({ repo, situation, close, changeSituation }: Ctx & { close: () => void; changeSituation: () => void }) {
  const byId = new Map(repo.data.tasks.map((t) => [t.id, t]));
  const counts = new Map<Infeasible, number>();
  for (const t of repo.data.tasks) {
    const why = infeasibility(t, situation, byId);
    if (why && why !== 'closed') counts.set(why, (counts.get(why) ?? 0) + 1);
  }
  const open = repo.data.tasks.filter((t) => t.status === 'open').length;
  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Close" onClick={close}>
          <CloseIcon />
        </button>
      </div>
      <h1>Nothing fits right now</h1>
      {counts.size > 0 ? (
        <div class="box">
          {[...counts].map(([why, n]) => (
            <div key={why}>
              {n} {n === 1 ? 'task' : 'tasks'} {INFEASIBLE_TEXT[why]}
            </div>
          ))}
        </div>
      ) : (
        <p class="muted">
          {open === 0 ? 'You have no open tasks.' : "You've skipped everything you could do in this session."}
        </p>
      )}
      <div class="grow" />
      <button class="btn primary block" onClick={changeSituation}>
        Change situation
      </button>
      <button class="btn block" onClick={close}>
        Back to tasks
      </button>
    </main>
  );
}

// Can't do it

function SubScreen({
  title,
  task,
  back,
  children,
}: {
  title: string;
  task: Task;
  back: () => void;
  children: ComponentChildren;
}) {
  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Back" onClick={back}>
          <BackIcon />
        </button>
      </div>
      <h1>{title}</h1>
      <div class="muted">{task.title}</div>
      {children}
    </main>
  );
}

function Reason({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <li>
      <button class="item" onClick={onClick}>
        <span>{title}</span>
        <span class="sub">{sub}</span>
      </button>
    </li>
  );
}

function CantDo({ task, repo, setMode, cant }: Ctx & { task: Task }) {
  const to = (name: Exclude<Mode['name'], 'step'>) => () => setMode({ name, task: task.id } as Mode);
  const tooTired = () => {
    repo.updateTask(task.id, { energy: 'focused' });
    cant(task.id, 'energy');
  };
  const dontWant = () => cant(task.id, 'dont_want', 'skipped');
  return (
    <SubScreen title="Why can't you do it now?" task={task} back={() => setMode({ name: 'step' })}>
      <ul class="list">
        <Reason title="Something has to happen first" sub="Pick or add what's blocking it" onClick={to('blocker')} />
        <Reason title="It'll take longer than I have" sub="Then: about how long?" onClick={to('duration')} />
        <Reason title="I'm not in the right place" sub="Then: where does it need to happen?" onClick={to('context')} />
        <Reason title="I'm missing something I need" sub="Then: what is it?" onClick={to('missing')} />
        <Reason title="I'm too tired for it" sub="Saved as needing focus" onClick={tooTired} />
        <Reason title="It's not worth doing anymore" sub="Drop it, or rank it again" onClick={to('not-worth')} />
        <Reason title="I just don't want to" sub="Counts as a skip, no more questions" onClick={dontWant} />
        <Reason title="Something else" sub="Type a reason" onClick={to('other-reason')} />
      </ul>
    </SubScreen>
  );
}

function BlockerPicker({ task, repo, setMode, cant }: Ctx & { task: Task }) {
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const needle = q.trim().toLowerCase();
  const options = repo.data.tasks
    .filter((o) => o.status === 'open' && o.id !== task.id && !task.dependsOn.includes(o.id))
    .filter((o) => !needle || o.title.toLowerCase().includes(needle))
    .slice(0, 8);
  const use = (blocker: Id) => {
    if (!repo.addDependency(task.id, blocker)) {
      setError('That task already waits on this one.');
      return;
    }
    cant(task.id, 'blocked');
  };
  const addNew = () => use(repo.addTask(q).id);
  return (
    <SubScreen title="What has to happen first?" task={task} back={() => setMode({ name: 'cant', task: task.id })}>
      <div class="field">
        <label for="blocker-search">Find a task or type a new one</label>
        <input id="blocker-search" class="input" value={q} onInput={(e) => setQ(e.currentTarget.value)} autoFocus />
      </div>
      <ul class="list">
        {options.map((o) => (
          <li key={o.id}>
            <button class="item" onClick={() => use(o.id)}>
              {o.title}
            </button>
          </li>
        ))}
        {needle && (
          <li>
            <button class="item dashed" onClick={addNew}>
              Add “{q.trim()}” as a new task
            </button>
          </li>
        )}
      </ul>
      {error && <span class="error">{error}</span>}
      <div class="box small">
        This task will be hidden until the other one is done. The other one becomes at least as important.
      </div>
    </SubScreen>
  );
}

function DurationPicker({ task, repo, situation, setMode, cant }: Ctx & { task: Task }) {
  const set = (d: number) => {
    repo.updateTask(task.id, { duration: d });
    cant(task.id, 'too_long');
  };
  return (
    <SubScreen title="About how long does it take?" task={task} back={() => setMode({ name: 'cant', task: task.id })}>
      <div class="chips">
        {DURATIONS.filter((d) => d > situation.minutes).map((d) => (
          <button key={d} class="chip" onClick={() => set(d)}>
            {formatDuration(d)}
          </button>
        ))}
        {situation.minutes >= DURATIONS[DURATIONS.length - 1] && (
          <button class="chip" onClick={() => set(DURATIONS[DURATIONS.length - 1])}>
            More than that (split it up)
          </button>
        )}
      </div>
    </SubScreen>
  );
}

function ContextNeeded({ task, repo, situation, setMode, cant }: Ctx & { task: Task }) {
  const [picked, setPicked] = useState<Id[]>([]);
  const save = () => {
    repo.updateTask(task.id, { contexts: [...new Set([...task.contexts, ...picked])] });
    cant(task.id, 'context');
  };
  return (
    <SubScreen title="Where does it need to happen?" task={task} back={() => setMode({ name: 'cant', task: task.id })}>
      <ContextChips selected={picked} onChange={setPicked} only={(id) => !situation.contexts.includes(id)} />
      <div class="grow" />
      <button class="btn primary block" disabled={picked.length === 0} onClick={save}>
        Save
      </button>
    </SubScreen>
  );
}

function MissingThing({ task, repo, setMode, cant }: Ctx & { task: Task }) {
  const [what, setWhat] = useState('');
  const save = (e: Event) => {
    e.preventDefault();
    if (!what.trim()) return;
    const blocker = repo.addTask(`Get: ${what.trim()}`);
    repo.addDependency(task.id, blocker.id);
    cant(task.id, 'missing');
  };
  return (
    <SubScreen title="What are you missing?" task={task} back={() => setMode({ name: 'cant', task: task.id })}>
      <form class="field" onSubmit={save}>
        <label for="missing">A thing, a person, or information</label>
        <input id="missing" class="input" value={what} onInput={(e) => setWhat(e.currentTarget.value)} autoFocus />
        <span class="muted small">This becomes a new task that has to happen first.</span>
        <button class="btn primary block" type="submit" disabled={!what.trim()}>
          Save
        </button>
      </form>
    </SubScreen>
  );
}

function NotWorth({ task, repo, setMode, cant }: Ctx & { task: Task }) {
  const drop = () => {
    repo.setStatus(task.id, 'dropped');
    cant(task.id, 'not_worth_dropped');
  };
  const rerank = () => {
    repo.updateTask(task.id, { resetAt: Date.now() });
    cant(task.id, 'not_worth_rerank');
  };
  return (
    <SubScreen title="Not worth doing anymore?" task={task} back={() => setMode({ name: 'cant', task: task.id })}>
      <ul class="list">
        <Reason title="Drop it" sub="Removed from your list" onClick={drop} />
        <Reason title="Rank it again" sub="Forget earlier answers about it and ask fresh" onClick={rerank} />
      </ul>
    </SubScreen>
  );
}

function OtherReason({ task, setMode, cant }: Ctx & { task: Task }) {
  const [text, setText] = useState('');
  const save = (e: Event) => {
    e.preventDefault();
    cant(task.id, `other: ${text.trim()}`);
  };
  return (
    <SubScreen title="What's stopping you?" task={task} back={() => setMode({ name: 'cant', task: task.id })}>
      <form class="field" onSubmit={save}>
        <label for="other">Reason</label>
        <input id="other" class="input" value={text} onInput={(e) => setText(e.currentTarget.value)} autoFocus />
        <button class="btn primary block" type="submit" disabled={!text.trim()}>
          Save
        </button>
      </form>
    </SubScreen>
  );
}

function DidOther({ task, repo, plan, setMode, next }: Ctx & { task: Task }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const options = repo.data.tasks
    .filter((o) => o.status === 'open' && o.id !== task.id)
    .filter((o) => !needle || o.title.toLowerCase().includes(needle))
    .slice(0, 8);
  const pick = (other: Id) => {
    // Doing something else is a "which first?" answer the user gave by acting.
    repo.addTradeoff({ chosen: other, other: task.id, features: features(plan, other, task.id), source: 'behavior' });
    repo.addSuggestion({ task: task.id, outcome: 'did_other', other });
    repo.setStatus(other, 'done');
    next();
  };
  return (
    <SubScreen title="What did you do instead?" task={task} back={() => setMode({ name: 'step' })}>
      <div class="field">
        <label for="did-search">Find the task</label>
        <input id="did-search" class="input" value={q} onInput={(e) => setQ(e.currentTarget.value)} autoFocus />
      </div>
      <ul class="list">
        {options.map((o) => (
          <li key={o.id}>
            <button class="item" onClick={() => pick(o.id)}>
              {o.title}
            </button>
          </li>
        ))}
        {needle && (
          <li>
            <button class="item dashed" onClick={() => pick(repo.addTask(q).id)}>
              Something new: “{q.trim()}”
            </button>
          </li>
        )}
      </ul>
    </SubScreen>
  );
}

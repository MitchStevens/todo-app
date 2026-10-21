import { useMemo } from 'preact/hooks';
import { buildBelief } from '../core/graph';
import type { Navigate } from './App';
import { delegateText } from './format';
import { useRepo } from './hooks';
import { BackIcon } from './icons';
import { GAP_Y, hasse, layout, NODE_H, NODE_W, type Routed } from './layout';

export function GraphView({ go }: { go: Navigate }) {
  const repo = useRepo();
  const now = Date.now();
  const { nodes, edges, loose, width, height } = useMemo(() => {
    const open = repo.data.tasks.filter((t) => t.status === 'open');
    const belief = buildBelief(
      repo.data.tasks.filter((t) => t.status !== 'dropped'),
      repo.data.comparisons,
      Date.now(),
    );
    return layout(open, hasse(open, belief));
  }, [repo.data]);
  const at = new Map(nodes.map((n) => [n.task.id, n]));
  // Spread each task's arrows along its edge, ordered by where the other end is, so they don't all meet in the middle.
  const centre = (id: string) => at.get(id)!.x + NODE_W / 2;
  /** Where an edge heads after leaving `from`, or comes from before reaching `to`. */
  const next = (e: Routed) => e.via[0] ?? centre(e.to);
  const prev = (e: Routed) => e.via[e.via.length - 1] ?? centre(e.from);
  const port = (e: Routed, side: 'in' | 'out') => {
    const id = side === 'in' ? e.to : e.from;
    const toward = side === 'in' ? prev : next;
    const ends = edges.filter((o) => (side === 'in' ? o.to : o.from) === id).sort((p, q) => toward(p) - toward(q));
    return at.get(id)!.x + (NODE_W * (ends.indexOf(e) + 1)) / (ends.length + 1);
  };
  /** A smooth path from the bottom of `from`, straight down each lane, to the top of `to`. */
  const route = (e: Routed) => {
    const top = at.get(e.from)!.y + NODE_H;
    const pts: [number, number][] = [[port(e, 'out'), top]];
    e.via.forEach((x, i) => {
      const y = top + GAP_Y + i * (NODE_H + GAP_Y);
      pts.push([x, y], [x, y + NODE_H]);
    });
    pts.push([port(e, 'in'), at.get(e.to)!.y]);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [[x1, y1], [x2, y2]] = [pts[i - 1], pts[i]];
      const my = (y1 + y2) / 2;
      d += i % 2 === 1 ? ` C${x1} ${my} ${x2} ${my} ${x2} ${y2}` : ` L${x2} ${y2}`;
    }
    return d;
  };
  const open = (id: string) => go({ name: 'edit', id, back: { name: 'graph' } });

  return (
    <main class="screen">
      <div class="bar">
        <button class="icon-btn" aria-label="Back to tasks" onClick={() => go({ name: 'list' })}>
          <BackIcon />
        </button>
        <h1 class="grow">Task graph</h1>
      </div>
      <p class="muted small" style="margin:0">
        Higher up goes first. A solid arrow means the lower task waits for the upper one. A dashed arrow means you said
        the upper one matters more.
      </p>

      {nodes.length === 0 ? (
        <p class="muted">
          Nothing is connected yet. Add tasks a task has to wait for, or answer a few "which matters more?" questions.
        </p>
      ) : (
        <div class="graph">
          <div style={{ position: 'relative', width: `${width}px`, height: `${height}px`, margin: '0 auto' }}>
            <svg width={width} height={height} style="position:absolute;inset:0;overflow:visible" aria-hidden="true">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0 0 L10 5 L0 10 z" />
                </marker>
              </defs>
              {edges.map((e) => {
                return (
                  <path key={`${e.from}-${e.to}`} class={`edge ${e.kind}`} d={route(e)} marker-end="url(#arrow)" />
                );
              })}
            </svg>
            {nodes.map(({ task: t, x, y }) => {
              const waiting = t.dependsOn.some((d) => repo.task(d)?.status === 'open');
              const sub = waiting ? 'Waiting' : t.delegated ? delegateText(t, now) : '';
              return (
                <button
                  key={t.id}
                  class={`node${waiting ? ' waiting' : ''}`}
                  style={{ left: `${x}px`, top: `${y}px`, width: `${NODE_W}px`, height: `${NODE_H}px` }}
                  onClick={() => open(t.id)}
                >
                  <span class="node-title">{t.title}</span>
                  {sub && <span class="sub">{sub}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loose.length > 0 && (
        <div class="field">
          <span class="label">Not connected to anything yet ({loose.length})</span>
          <ul class="list">
            {loose.map((t) => (
              <li key={t.id}>
                <button class="item" onClick={() => open(t.id)}>
                  {t.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}

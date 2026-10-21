import type { Belief } from '../core/graph';
import type { Id, Task } from '../core/types';

export const NODE_W = 148;
export const NODE_H = 72;
export const GAP_X = 16;
export const GAP_Y = 48;

/** `from` goes before `to`: a blocker, or a task you said matters more. */
export interface GraphEdge {
  from: Id;
  to: Id;
  kind: 'dependency' | 'importance';
}

export interface Placed {
  task: Task;
  x: number;
  y: number;
}

/** An edge with the x of its lane in each row it passes through, top to bottom. */
export interface Routed extends GraphEdge {
  via: number[];
}

export interface GraphLayout {
  nodes: Placed[];
  edges: Routed[];
  /** Tasks with no edges, listed separately rather than drawn. */
  loose: Task[];
  width: number;
  height: number;
}

/**
 * The Hasse diagram of the effective order on `tasks`: only edges not implied
 * by a path through another task. Dependencies are always kept, since they
 * are hard facts the user entered.
 */
export function hasse(tasks: Task[], belief: Belief): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const a of tasks) {
    for (const b of tasks) {
      if (a === b || !belief.above(a.id, b.id)) continue;
      const dependency = b.dependsOn.includes(a.id);
      const implied = tasks.some((c) => c !== a && c !== b && belief.above(a.id, c.id) && belief.above(c.id, b.id));
      if (dependency || !implied) edges.push({ from: a.id, to: b.id, kind: dependency ? 'dependency' : 'importance' });
    }
  }
  return edges;
}

/** Width of the lane a long edge takes in each row it passes through. */
const LANE_W = 12;

/**
 * Layered top-to-bottom layout: each task one row below its lowest predecessor.
 * An edge that skips rows gets a narrow lane in each row it crosses, so it is
 * ordered along with the tasks and routed around them rather than behind them.
 */
export function layout(tasks: Task[], edges: GraphEdge[]): GraphLayout {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = tasks.filter((t) => linked.has(t.id));
  const parents = new Map<Id, Id[]>(nodes.map((t) => [t.id, []]));
  const children = new Map<Id, Id[]>(nodes.map((t) => [t.id, []]));
  for (const e of edges) {
    children.get(e.from)?.push(e.to);
    parents.get(e.to)?.push(e.from);
  }

  // Topological order (the edges come from an acyclic order), then longest path for rows.
  const indegree = new Map(nodes.map((t) => [t.id, parents.get(t.id)!.length]));
  const order = nodes.filter((t) => indegree.get(t.id) === 0).map((t) => t.id);
  const row = new Map<Id, number>();
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    row.set(u, Math.max(0, ...parents.get(u)!.map((p) => row.get(p)! + 1)));
    for (const v of children.get(u)!) {
      indegree.set(v, indegree.get(v)! - 1);
      if (indegree.get(v) === 0) order.push(v);
    }
  }
  const rows: Id[][] = [];
  for (const id of order) (rows[row.get(id)!] ??= []).push(id);

  // Lanes for edges that skip rows, chained so each segment spans one row.
  const up = new Map<Id, Id[]>(order.map((id) => [id, []]));
  const down = new Map<Id, Id[]>(order.map((id) => [id, []]));
  const lanes = edges.map((e, i) => {
    const ids: Id[] = [];
    let prev = e.from;
    for (let r = row.get(e.from)! + 1; r < row.get(e.to)!; r++) {
      const lane = `lane:${i}:${r}`;
      rows[r].push(lane);
      ids.push(lane);
      up.set(lane, []);
      down.set(lane, []);
      down.get(prev)!.push(lane);
      up.get(lane)!.push(prev);
      prev = lane;
    }
    down.get(prev)!.push(e.to);
    up.get(e.to)!.push(prev);
    return ids;
  });
  const isLane = (id: Id) => id.startsWith('lane:');
  const w = (id: Id) => (isLane(id) ? LANE_W : NODE_W);

  // Reduce crossings: sort each row by the mean centre of its neighbours,
  // sweeping down then up. Each row is packed and centred on 0.
  const centre = new Map<Id, number>();
  const place = (r: Id[]) => {
    let x = -(r.reduce((s, id) => s + w(id), 0) + GAP_X * (r.length - 1)) / 2;
    for (const id of r) {
      centre.set(id, x + w(id) / 2);
      x += w(id) + GAP_X;
    }
  };
  rows.forEach(place);
  const mean = (id: Id, nbrs: Id[]) =>
    nbrs.length ? nbrs.reduce((s, n) => s + centre.get(n)!, 0) / nbrs.length : centre.get(id)!;
  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0;
    for (const r of downward ? rows.slice(1) : rows.slice(0, -1).reverse()) {
      const key = new Map(r.map((id) => [id, mean(id, (downward ? up : down).get(id)!)]));
      r.sort((a, b) => key.get(a)! - key.get(b)!);
      place(r);
    }
  }

  const left = Math.min(0, ...rows.map((r) => centre.get(r[0])! - w(r[0]) / 2));
  const right = Math.max(0, ...rows.map((r) => centre.get(r[r.length - 1])! + w(r[r.length - 1]) / 2));
  const byId = new Map(nodes.map((t) => [t.id, t]));
  return {
    nodes: order.map((id) => ({
      task: byId.get(id)!,
      x: centre.get(id)! - NODE_W / 2 - left,
      y: row.get(id)! * (NODE_H + GAP_Y),
    })),
    edges: edges.map((e, i) => ({ ...e, via: lanes[i].map((id) => centre.get(id)! - left) })),
    loose: tasks.filter((t) => !linked.has(t.id)),
    width: right - left,
    height: Math.max(0, rows.length * (NODE_H + GAP_Y) - GAP_Y),
  };
}

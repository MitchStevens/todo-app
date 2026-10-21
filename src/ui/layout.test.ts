import { describe, expect, it } from 'vitest';
import { buildBelief } from '../core/graph';
import type { Comparison, Task } from '../core/types';
import { GAP_Y, hasse, layout, NODE_H, NODE_W } from './layout';

const NOW = Date.UTC(2026, 9, 21);

function task(id: string, dependsOn: string[] = []): Task {
  return { id, title: id, notes: '', createdAt: NOW, editedAt: NOW, contexts: [], energy: 'any', dependsOn, status: 'open' };
}

function cmp(a: string, b: string): Comparison {
  return { id: `${a}>${b}`, a, b, result: 'a', at: NOW, latencyMs: 1000, kind: 'initial', contexts: [] };
}

describe('task graph', () => {
  it('draws only edges not implied by another path, but always keeps dependencies', () => {
    const tasks = [task('a'), task('b'), task('c', ['a']), task('lone')];
    const belief = buildBelief(tasks, [cmp('a', 'b'), cmp('b', 'c')], NOW);
    const edges = hasse(tasks, belief);
    expect(edges).toContainEqual({ from: 'a', to: 'b', kind: 'importance' });
    expect(edges).toContainEqual({ from: 'b', to: 'c', kind: 'importance' });
    expect(edges).toContainEqual({ from: 'a', to: 'c', kind: 'dependency' });
    expect(edges).toHaveLength(3);
  });

  it('puts each task one row below its lowest predecessor, and lists unconnected tasks separately', () => {
    const tasks = [task('a'), task('b'), task('c', ['a']), task('lone')];
    const belief = buildBelief(tasks, [cmp('a', 'b'), cmp('b', 'c')], NOW);
    const { nodes, loose } = layout(tasks, hasse(tasks, belief));
    const y = Object.fromEntries(nodes.map((n) => [n.task.id, n.y / (NODE_H + GAP_Y)]));
    expect(y).toEqual({ a: 0, b: 1, c: 2 });
    expect(loose.map((t) => t.id)).toEqual(['lone']);
  });

  it('orders a row to follow its parents, to avoid crossings', () => {
    const tasks = [task('p1'), task('p2'), task('c2', ['p2']), task('c1', ['p1'])];
    const belief = buildBelief(tasks, [], NOW);
    const { nodes } = layout(tasks, hasse(tasks, belief));
    const x = Object.fromEntries(nodes.map((n) => [n.task.id, n.x]));
    expect(Math.sign(x.p1 - x.p2)).toBe(Math.sign(x.c1 - x.c2));
  });

  it('routes an edge that skips a row through a lane clear of the tasks in that row', () => {
    const tasks = [task('a'), task('b'), task('c'), task('d')];
    const belief = buildBelief(tasks, [cmp('a', 'b'), cmp('b', 'c'), cmp('d', 'c'), cmp('a', 'd')], NOW);
    const g = layout(tasks, [...hasse(tasks, belief), { from: 'a', to: 'c', kind: 'dependency' }]);
    const long = g.edges.find((e) => e.from === 'a' && e.to === 'c')!;
    expect(long.via).toHaveLength(1);
    const middle = g.nodes.filter((n) => n.y === NODE_H + GAP_Y);
    for (const n of middle) expect(long.via[0] < n.x || long.via[0] > n.x + NODE_W).toBe(true);
  });
});

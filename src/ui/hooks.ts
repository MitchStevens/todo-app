import { createContext } from 'preact';
import { useContext, useEffect, useReducer } from 'preact/hooks';
import type { Repo } from '../store/repo';

export const RepoContext = createContext<Repo | null>(null);

/** The repo, re-rendering the caller whenever any data changes. */
export function useRepo(): Repo {
  const repo = useContext(RepoContext);
  if (!repo) throw new Error('useRepo outside RepoContext');
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => repo.subscribe(() => rerender(undefined)), [repo]);
  return repo;
}

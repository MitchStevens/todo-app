import { useState } from 'preact/hooks';
import type { Id, Situation } from '../core/types';
import type { Repo } from '../store/repo';
import { RepoContext } from './hooks';
import { SessionView } from './SessionView';
import { Settings } from './Settings';
import { SituationPicker } from './SituationPicker';
import { TaskEdit } from './TaskEdit';
import { TaskList } from './TaskList';

export type Route =
  | { name: 'list' }
  | { name: 'edit'; id: Id }
  | { name: 'situation' }
  | { name: 'session'; situation: Situation }
  | { name: 'settings' };

export type Navigate = (r: Route) => void;

export function App({ repo }: { repo: Repo }) {
  const [route, setRoute] = useState<Route>({ name: 'list' });
  const go: Navigate = (r) => {
    setRoute(r);
    window.scrollTo(0, 0);
  };
  return (
    <RepoContext.Provider value={repo}>
      {route.name === 'list' && <TaskList go={go} />}
      {route.name === 'edit' && <TaskEdit id={route.id} go={go} />}
      {route.name === 'situation' && <SituationPicker go={go} />}
      {route.name === 'session' && <SessionView situation={route.situation} go={go} />}
      {route.name === 'settings' && <Settings go={go} />}
    </RepoContext.Provider>
  );
}

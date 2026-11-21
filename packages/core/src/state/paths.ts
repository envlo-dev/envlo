import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export const DEFAULT_STATE_DB_NAME = ".envlo/state.db";

/** Default SQLite path: `~/.envlo/state.db`. */
export function defaultStateDbPath(): string {
  return resolve(homedir(), DEFAULT_STATE_DB_NAME);
}

/** Parent directory of the state DB (for mkdir). */
export function stateDbParentDir(dbPath: string): string {
  return dirname(resolve(dbPath));
}

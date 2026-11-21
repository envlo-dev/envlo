/**
 * Minimal sync SQLite surface used by `SqliteStateStore`.
 * Satisfied by Node.js `node:sqlite` `DatabaseSync` (22.12+).
 */
export type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Array<Record<string, unknown>>;
};

export type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

export type SqliteModule = {
  DatabaseSync: new (
    path: string,
    options?: { open?: boolean; enableForeignKeyConstraints?: boolean },
  ) => SqliteDatabase;
};

/** Dynamically load `node:sqlite` when available (Node >= 22.5 / 22.12). */
export async function loadNodeSqlite(): Promise<SqliteModule> {
  try {
    return (await import("node:sqlite")) as unknown as SqliteModule;
  } catch (error) {
    throw new Error(
      "SQLite state store requires Node.js built-in node:sqlite (Node >= 22.12). " +
        "Use MemoryStateStore on other runtimes.",
      { cause: error },
    );
  }
}

export async function isNodeSqliteAvailable(): Promise<boolean> {
  try {
    await loadNodeSqlite();
    return true;
  } catch {
    return false;
  }
}

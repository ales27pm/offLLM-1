import { up as init } from "./0001_initial";

export const CURRENT_VERSION = 1;

export async function runMigrations(data: { version: number; items: any[] }) {
  if (data.version < 1) {
    await init(data);
  }
}

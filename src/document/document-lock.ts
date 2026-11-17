import type { EntityManager } from 'typeorm';

/** Serializes document mutations and index writes across application instances. */
export async function lockDocument(manager: EntityManager, id: string) {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `document:${id}`,
  ]);
}

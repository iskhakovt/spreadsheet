/**
 * Extract exactly one row from a query result. Throws if zero or multiple rows.
 */
export function single<T>(rows: T[]): T {
  if (rows.length === 0) throw new Error("Expected exactly 1 row, got 0");
  if (rows.length > 1) throw new Error(`Expected exactly 1 row, got ${rows.length}`);
  return rows[0];
}

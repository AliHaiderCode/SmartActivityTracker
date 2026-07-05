import db from "../db.server";

/**
 * Activity log retention.
 *
 * Logs older than LOG_RETENTION_DAYS (default 90) are deleted. This keeps the
 * database bounded and satisfies the "retention period" data-protection
 * requirement in the Shopify app review questionnaire.
 *
 * Set LOG_RETENTION_DAYS=0 to disable pruning and keep everything forever.
 */

const DEFAULT_RETENTION_DAYS = 90;
// Run at most once per day even if the boot hook fires more often.
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function getRetentionDays() {
  const raw = process.env.LOG_RETENTION_DAYS;
  if (raw == null || raw === "") return DEFAULT_RETENTION_DAYS;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return DEFAULT_RETENTION_DAYS;
  return n;
}

/** Delete logs older than the retention window. Returns the deleted count. */
export async function pruneOldLogs() {
  const days = getRetentionDays();
  if (days === 0) return 0; // retention disabled

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const { count } = await db.activityLog.deleteMany({
    where: { occurredAt: { lt: cutoff } },
  });
  if (count > 0) {
    console.log(`[retention] pruned ${count} logs older than ${days} days`);
  }
  return count;
}

let scheduled = false;

/**
 * Start the retention job: run once now, then daily. Idempotent — safe to call
 * on every server boot; the timer is only registered once per process.
 */
export function startRetentionSchedule() {
  if (scheduled) return;
  scheduled = true;

  pruneOldLogs().catch((error) =>
    console.error("[retention] initial prune failed", error),
  );

  const timer = setInterval(() => {
    pruneOldLogs().catch((error) =>
      console.error("[retention] scheduled prune failed", error),
    );
  }, CLEANUP_INTERVAL_MS);

  // Don't keep the event loop alive just for this timer.
  if (typeof timer.unref === "function") timer.unref();
}

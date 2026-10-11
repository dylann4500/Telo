import type { TaskStatus } from "./types";

// The only legal moves between task states. Every transition is applied as
// a compare-and-swap on (status, version), so two webhooks racing for the
// same task can't both move it, and a duplicate delivery becomes a no-op.

export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  new: ["needs_info", "planning", "completed", "failed", "cancelled"],
  needs_info: ["new", "planning", "scheduled", "reviewing", "failed", "cancelled"],
  planning: ["ready", "scheduled", "needs_info", "completed", "failed", "cancelled"],
  ready: ["calling", "reviewing", "needs_info", "failed", "cancelled"],
  calling: ["reviewing", "failed", "cancelled"],
  reviewing: ["ready", "planning", "needs_approval", "needs_info", "scheduled", "completed", "failed", "cancelled"],
  needs_approval: ["reviewing", "planning", "completed", "cancelled", "failed"],
  scheduled: ["ready", "planning", "reviewing", "cancelled", "failed"],
  completed: [],
  failed: ["new"], // the user can ask Telo to try again
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** States a task can be moved into `to` from. */
export function sourcesFor(to: TaskStatus): TaskStatus[] {
  return (Object.keys(TRANSITIONS) as TaskStatus[]).filter((from) => canTransition(from, to));
}

export const ACTIONABLE: readonly TaskStatus[] = ["new", "planning", "ready", "reviewing"];

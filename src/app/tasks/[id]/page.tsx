import { Suspense } from "react";
import { TaskDetail } from "@/components/task-detail";

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto w-full max-w-6xl px-6 py-10 text-muted">Loading…</div>}>
      <TaskDetail />
    </Suspense>
  );
}

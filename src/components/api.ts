"use client";

import useSWR from "swr";
import type { StateDTO, TaskDetailDTO } from "@/lib/types";

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
};

/** The whole home screen, refreshed every 1.5 s (faster while a call is live). */
export function useAppState() {
  return useSWR<StateDTO>("/api/state", fetcher, {
    refreshInterval: (data) => (data?.tasks.some((t) => t.live) ? 1000 : 1500),
    revalidateOnFocus: true,
  });
}

export function useTask(id: string | undefined) {
  return useSWR<TaskDetailDTO>(id ? `/api/tasks/${id}` : null, fetcher, {
    refreshInterval: (data) => (data && ["completed", "failed", "cancelled"].includes(data.status) ? 5000 : 1000),
  });
}

export async function post(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

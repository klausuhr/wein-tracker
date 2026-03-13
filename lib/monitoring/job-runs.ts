import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerAdminClient } from "../supabase/server-admin";

type JobStatus = "ok" | "failed";

type RecordJobRunInput = {
  jobName: string;
  status: JobStatus;
  startedAt: Date;
  finishedAt: Date;
  details?: Record<string, unknown>;
};

export async function recordJobRun(
  input: RecordJobRunInput,
  client?: SupabaseClient
): Promise<void> {
  const supabase = client ?? createServerAdminClient();
  const durationMs = Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());

  const { error } = await supabase.from("job_runs").insert({
    job_name: input.jobName,
    status: input.status,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    duration_ms: durationMs,
    details: input.details ?? {}
  });

  if (error) {
    throw new Error(`Failed to record job run: ${error.message}`);
  }
}

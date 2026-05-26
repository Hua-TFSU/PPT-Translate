import { nanoid } from "nanoid";

const jobs = new Map();

export function createJob(input) {
  const now = new Date().toISOString();
  const job = {
    id: nanoid(10),
    status: "queued",
    message: "等待处理",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    ...input
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id);
}

export function listJobs() {
  return Array.from(jobs.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toPublicJob);
}

export function updateJob(id, patch) {
  const current = jobs.get(id);
  if (!current) return undefined;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  jobs.set(id, next);
  return next;
}

export function toPublicJob(job) {
  if (!job) return undefined;
  const { filepath, ...safeJob } = job;
  return safeJob;
}

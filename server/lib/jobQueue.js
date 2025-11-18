import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const JOBS_DIR = path.join(process.cwd(), 'data', 'jobs');
const QUEUE_FILE = path.join(JOBS_DIR, 'queue.json');
const DEFAULT_POLL_INTERVAL = 1000;

let inMemoryQueue = [];
let processorFn = null;
let processing = false;
let pollInterval = DEFAULT_POLL_INTERVAL;
let pendingWorkRequestHandler = null;

async function ensureJobsDir() {
  if (!existsSync(JOBS_DIR)) {
    await fs.mkdir(JOBS_DIR, { recursive: true });
  }
}

async function loadQueue() {
  try {
    await ensureJobsDir();
    const raw = await fs.readFile(QUEUE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      inMemoryQueue = parsed;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      inMemoryQueue = [];
      await saveQueue();
    } else {
      console.error('Failed to load job queue:', error);
    }
  }
}

async function saveQueue() {
  await ensureJobsDir();
  await fs.writeFile(QUEUE_FILE, JSON.stringify(inMemoryQueue, null, 2), 'utf-8');
}

function scheduleProcessing() {
  if (!processorFn || processing) {
    return;
  }
  processing = true;
  setImmediate(processLoop);
}

async function processLoop() {
  try {
    while (processorFn) {
      const now = Date.now();
      const nextJob = inMemoryQueue.find(
        (job) => job.status === 'queued' && (!job.nextRunAt || job.nextRunAt <= now)
      );
      if (!nextJob) {
        break;
      }

      nextJob.status = 'processing';
      nextJob.startedAt = Date.now();
      await saveQueue();

      try {
        await processorFn(nextJob);
        nextJob.status = 'completed';
        nextJob.completedAt = Date.now();
        nextJob.error = null;
      } catch (error) {
        const retryable = error && error.retryable;
        nextJob.attempts = (nextJob.attempts || 0) + 1;
        nextJob.error = error?.message || String(error);

        if (retryable) {
          nextJob.status = 'queued';
          nextJob.nextRunAt = Date.now() + (error.retryDelayMs || pollInterval);
        } else {
          nextJob.status = 'failed';
          nextJob.failedAt = Date.now();
        }
      }

      await saveQueue();

      if (nextJob.status === 'queued') {
        // Break to respect retry delay (handled by poll timer)
        break;
      }
    }
  } finally {
    processing = false;
    if (processorFn) {
      setTimeout(() => {
        const now = Date.now();
        const queuedJobs = inMemoryQueue.filter((job) => job.status === 'queued');
        if (queuedJobs.length === 0) {
          return;
        }
        const nextDueAt = queuedJobs.reduce((earliest, job) => {
          const dueAt = job.nextRunAt || now;
          return dueAt < earliest ? dueAt : earliest;
        }, Infinity);
        const delay = Math.max(0, (nextDueAt === Infinity ? now : nextDueAt) - now);
        if (queuedJobs.some((job) => !job.nextRunAt || job.nextRunAt <= now)) {
          scheduleProcessing();
        } else {
          setTimeout(() => scheduleProcessing(), Math.max(delay, pollInterval));
        }
      }, pollInterval);
    }
  }
}

export async function initializeJobQueue(options = {}) {
  if (options.pollIntervalMs && Number.isFinite(options.pollIntervalMs)) {
    pollInterval = Math.max(100, Number(options.pollIntervalMs));
  }
  await loadQueue();
}

export async function enqueueJob(type, payload) {
  const job = {
    id: crypto.randomUUID(),
    type,
    payload,
    status: 'queued',
    createdAt: Date.now(),
    attempts: 0,
    error: null
  };
  inMemoryQueue.push(job);
  await saveQueue();
  scheduleProcessing();
  return job;
}

export function registerJobProcessor(fn) {
  processorFn = fn;
  scheduleProcessing();
}

export function registerPendingWorkRequestHandler(handler) {
  pendingWorkRequestHandler = typeof handler === 'function' ? handler : null;
}

export function requestPendingWorkScan(delay = 0) {
  if (typeof pendingWorkRequestHandler === 'function') {
    pendingWorkRequestHandler(delay);
  }
}

export async function clearJobs(filterFn) {
  if (!filterFn) {
    inMemoryQueue = [];
  } else {
    inMemoryQueue = inMemoryQueue.filter((job) => !filterFn(job));
  }
  await saveQueue();
}

export function listJobs() {
  return [...inMemoryQueue];
}

export class RetryableJobError extends Error {
  constructor(message, retryDelayMs = DEFAULT_POLL_INTERVAL) {
    super(message);
    this.retryable = true;
    this.retryDelayMs = retryDelayMs;
  }
}

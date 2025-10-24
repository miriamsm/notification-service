import { Queue, QueueOptions, QueueEvents } from 'bullmq';
import { queueRedis } from './redis';
import { NotificationJobData } from '../types';

/**
 * Queue Options Configuration
 * 
 * These options apply to ALL jobs in the queue
 */
const queueOptions: QueueOptions = {
  // Use our dedicated Redis connection
  connection: queueRedis,
  
  /**
   * Default Job Options
   * 
   * Applied to every job unless overridden
   */
  defaultJobOptions: {
    /**
     * Attempts: How many times to retry on failure
     * 
     * Why 3?
     * - Attempt 1: Original try
     * - Attempt 2: Maybe transient network error
     * - Attempt 3: Final attempt
     * - After 3: Permanent failure, move to Dead Letter Queue
     * 
     * Why not more?
     * - If it fails 3 times, likely a real problem (invalid email, template error)
     * - Too many retries waste resources
     */
    attempts: 3,
    
    /**
     * Backoff Strategy
     * 
     * How long to wait between retries?
     * - Exponential: Each retry waits longer
     * - Delay: Starting delay in milliseconds
     * 
     * Timeline:
     * - Attempt 1 fails: wait 1 minute  (60000ms)
     * - Attempt 2 fails: wait 2 minutes (60000 * 2)
     * - Attempt 3 fails: wait 4 minutes (60000 * 4)
     * 
     * Why exponential backoff?
     * - Give external service time to recover
     * - If SendGrid is rate-limiting us, exponential backoff helps
     * - Prevents thundering herd problem
     */
    backoff: {
      type: 'exponential',
      delay: 60000, // Start with 1 minute
    },
    
    /**
     * Remove Completed Jobs
     * 
     * Why remove successful jobs?
     * - Redis memory is limited
     * - Completed jobs aren't needed forever
     * - Keep recent ones for debugging
     * 
     * age: Keep for 1 hour (3600 seconds)
     * count: Keep last 1000 completed jobs
     * 
     * Whichever limit hits first triggers cleanup
     */
    removeOnComplete: {
      age: 3600,    // 1 hour in seconds
      count: 1000,  // Last 1000 jobs
    },
    
    /**
     * Remove Failed Jobs
     * 
     * Why keep failed jobs longer?
     * - Need time to investigate failures
     * - Might need to manually retry
     * - Important for debugging
     * 
     * age: Keep for 24 hours (86400 seconds)
     * 
     * No count limit - keep all failures within 24h
     */
    removeOnFail: {
      age: 86400, // 24 hours
    },
  },
};

/**
 * Create the Notification Queue
 * 
 * This is the main queue object
 * - API will use this to ADD jobs
 * - Worker will use this to PROCESS jobs
 */
export const notificationQueue = new Queue<NotificationJobData>(
  'notifications',  // Queue name (key in Redis)
  queueOptions
);

/**
 * Queue Events
 * 
 * BullMQ v5 separates queue events into QueueEvents class
 * This allows better scalability and memory usage
 * 
 * Why separate QueueEvents?
 * - Queue class is for adding/managing jobs
 * - QueueEvents is for listening to events
 * - Can have multiple listeners without blocking queue
 */
const queueEvents = new QueueEvents('notifications', {
  connection: queueRedis,
});

/**
 * Queue Event Listeners
 * 
 * Why listen to queue events?
 * - Monitoring: know if queue is healthy
 * - Debugging: track job lifecycle
 * - Metrics: count jobs processed, failed, etc.
 * 
 * Note: BullMQ v5 changed event signatures
 * Events now receive objects with specific properties
 */

// When job is waiting in queue
queueEvents.on('waiting', ({ jobId }: { jobId: string }) => {
  console.log(`Job ${jobId} is waiting to be processed`);
});

// When job is actively being processed
queueEvents.on('active', ({ jobId, prev }: { jobId: string; prev?: string }) => {
  console.log(`Job ${jobId} is now active`);
});

// When job completes successfully
queueEvents.on('completed', ({ jobId, returnvalue }: { jobId: string; returnvalue: any }) => {
  console.log(`Job ${jobId} completed successfully`);
});

// When job fails (after all retries)
queueEvents.on('failed', ({ jobId, failedReason }: { jobId: string; failedReason: string }) => {
  console.error(`Job ${jobId} failed: ${failedReason}`);
});

// When job is delayed (scheduled for future)
queueEvents.on('delayed', ({ jobId, delay }: { jobId: string; delay: number }) => {
  console.log(`Job ${jobId} delayed by ${delay}ms`);
});

// When job moves to retry
queueEvents.on('added', ({ jobId }: { jobId: string }) => {
  console.log(`Job ${jobId} added to queue`);
});

/**
 * Queue-level errors
 * 
 * These are errors with the queue system itself, not individual jobs
 */
queueEvents.on('error', (err: Error) => {
  console.error('Queue error:', err);
  // Critical: queue system failing
  // In production: page on-call engineer
});

// Also listen for connection errors on the queue itself
notificationQueue.on('error', (err: Error) => {
  console.error('Queue connection error:', err);
});

console.log('✓ Notification queue initialized');

/**
 * Helper Functions for Queue Management
 */

/**
 * Get Queue Statistics
 * 
 * Useful for monitoring dashboards
 */
export async function getQueueStats() {
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    notificationQueue.getWaitingCount(),
    notificationQueue.getActiveCount(),
    notificationQueue.getCompletedCount(),
    notificationQueue.getFailedCount(),
    notificationQueue.getDelayedCount(),
  ]);
  
  return {
    waiting,    // Jobs waiting to be processed
    active,     // Jobs currently being processed
    completed,  // Successfully completed jobs (in retention period)
    failed,     // Failed jobs (in retention period)
    delayed,    // Jobs scheduled for future
    total: waiting + active + completed + failed + delayed,
  };
}

/**
 * Get Job by ID
 * 
 * Retrieve specific job for inspection
 */
export async function getJob(jobId: string) {
  return await notificationQueue.getJob(jobId);
}

/**
 * Pause Queue
 * 
 * Temporarily stop processing jobs
 * Useful for maintenance or emergencies
 */
export async function pauseQueue(): Promise<void> {
  await notificationQueue.pause();
  console.log('Queue paused');
}

/**
 * Resume Queue
 * 
 * Resume processing after pause
 */
export async function resumeQueue(): Promise<void> {
  await notificationQueue.resume();
  console.log('Queue resumed');
}

/**
 * Drain Queue
 * 
 * Remove all waiting/delayed jobs
 * Does NOT remove active or completed jobs
 */
export async function drainQueue(): Promise<void> {
  await notificationQueue.drain();
  console.log('Queue drained (waiting jobs removed)');
}

/**
 * Clean Queue
 * 
 * Remove old jobs based on criteria
 * 
 * @param grace - Milliseconds to keep jobs (0 = remove all)
 * @param limit - Max number to remove per call
 * @param type - Which jobs to clean (completed, failed, etc.)
 */
export async function cleanQueue(
  grace: number = 0,
  limit: number = 1000,
  type: 'completed' | 'failed' | 'delayed' | 'wait' = 'completed'
): Promise<string[]> {
  const jobs = await notificationQueue.clean(grace, limit, type);
  console.log(`Cleaned ${jobs.length} ${type} jobs`);
  return jobs;
}

/**
 * Obliterate Queue
 * 
 * WARNING: Nuclear option - deletes EVERYTHING including queue itself
 * Use only for testing or complete reset
 */
export async function obliterateQueue(): Promise<void> {
  await notificationQueue.obliterate({ force: true });
  console.log('Queue obliterated (all data removed)');
}

/**
 * Graceful Shutdown
 * 
 * Close queue and events connections cleanly
 */
export async function closeQueue(): Promise<void> {
  await queueEvents.close();
  await notificationQueue.close();
  console.log('✓ Queue and events closed');
}

/**
 * Export queue events for use in other modules
 */
export { queueEvents };
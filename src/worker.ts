/**
 * Worker Entry Point
 * 
 * Purpose: Start background worker that processes notification queue
 * 
 * This is separate from server.ts (API)
 * - server.ts: Receives HTTP requests, adds jobs to queue
 * - worker.ts: Processes queued jobs, sends notifications
 * 
 * Why separate?
 * - Can scale independently (more workers, fewer APIs or vice versa)
 * - API stays responsive (not blocked by slow external services)
 * - Workers can be on different servers/containers
 * - If worker crashes, API still works
 * 
 * In production:
 * - Run multiple worker instances for redundancy
 * - Deploy in separate containers/servers
 * - Monitor separately from API
 */

import dotenv from 'dotenv';
import { worker } from './workers/NotificationWorker';
import { pool, closeDatabase } from './config/database';
import { queueRedis, closeRedis } from './config/redis';

// Load environment variables
dotenv.config();

/**
 * Configuration
 */
const NODE_ENV = process.env.NODE_ENV || 'development';
const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5');

/**
 * Start Worker
 * 
 * Initialize connections and start processing jobs
 */
async function startWorker() {
  try {
    /**
     * Test database connection
     * 
     * Worker needs database to:
     * - Fetch notification details
     * - Update notification status
     * - Create delivery logs
     */
    await pool.query('SELECT NOW()');
    console.log('✓ Database connected');
    
    /**
     * Test Redis connection
     * 
     * Worker needs Redis for:
     * - Receiving jobs from queue
     * - Updating job status
     * - Handling retries
     */
    await queueRedis.ping();
    console.log('✓ Redis connected');
    
    /**
     * Display Worker Information
     */
    console.log('');
    console.log('='.repeat(60));
    console.log(`🔧 Notification Worker`);
    console.log('='.repeat(60));
    console.log(`Environment: ${NODE_ENV}`);
    console.log(`Concurrency: ${WORKER_CONCURRENCY} jobs simultaneously`);
    console.log(`Queue: notifications`);
    console.log(`Retry Strategy: Exponential backoff`);
    console.log(`Max Attempts: 3 per notification`);
    console.log('='.repeat(60));
    console.log('');
    console.log('Worker is running. Press Ctrl+C to stop.');
    console.log('');
    
    /**
     * Worker is now running
     * 
     * The worker will:
     * 1. Listen for new jobs in the queue
     * 2. Process jobs according to concurrency limit
     * 3. Retry failed jobs with exponential backoff
     * 4. Log all activity
     * 
     * Worker events are handled in NotificationWorker.ts
     */
    
  } catch (error) {
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

/**
 * Graceful Shutdown Handler
 * 
 * Handles SIGTERM and SIGINT signals (Ctrl+C, Docker stop, etc.)
 * 
 * Shutdown flow:
 * 1. Stop accepting new jobs
 * 2. Wait for active jobs to complete (up to 30s)
 * 3. Close database connection
 * 4. Close Redis connection
 * 5. Exit cleanly
 * 
 * Why graceful shutdown?
 * - Don't leave jobs half-processed
 * - Prevent data corruption
 * - Clean up connections properly
 * - Allow job to be retried by another worker
 */
async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    /**
     * Step 1: Close worker
     * 
     * Stops accepting new jobs
     * Waits for active jobs to complete
     * Returns when all jobs finished or timeout reached
     */
    console.log('Waiting for active jobs to complete...');
    await worker.close();
    console.log('✓ Worker closed');
    
    /**
     * Step 2: Close database
     * 
     * Closes all connections in pool
     * Prevents new queries
     */
    await closeDatabase();
    
    /**
     * Step 3: Close Redis
     * 
     * Closes queue connection
     * Important: Do this AFTER worker.close()
     * Worker needs Redis connection to finish jobs
     */
    await closeRedis();
    
    console.log('✓ All connections closed');
    console.log('Goodbye! 👋');
    
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

/**
 * Register Signal Handlers
 * 
 * SIGTERM: Sent by Docker, Kubernetes, systemd
 * SIGINT: Sent by Ctrl+C in terminal
 */
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Handle Uncaught Errors
 * 
 * Last resort error handlers
 * Should never trigger if code is correct
 * But good safety net for unexpected errors
 */
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});

/**
 * Start the worker
 */
startWorker();

/**
 * Export worker for testing
 */
export { worker };
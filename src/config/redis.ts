/**
 * Redis Configuration
 */

import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Main Redis Client (for caching)
 */
export const redisClient = new Redis({
  // Connection details
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  
  /**
   * Retry Strategy
   */
  retryStrategy(times) {
    // times = number of failed attempts
    const delay = Math.min(times * 50, 2000);
    console.log(`Redis reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  
  /**
   * Max retries per request
   * 
   * If a single command fails, how many times to retry?
   * 3 is reasonable for most cases
   */
  maxRetriesPerRequest: 3,
  
  /**
   * Enable offline queue
   * 
   * If Redis is down, queue commands in memory
   * Execute them when connection is restored
   * Default: true (good for caching)
   */
  enableOfflineQueue: true,
});

/**
 * Separate Redis Client for BullMQ
 * 
 * Why separate client?
 * - BullMQ requires maxRetriesPerRequest: null
 * - BullMQ handles its own retry logic
 * - Isolation: if caching breaks, queue still works
 * - BullMQ official recommendation
 */
export const queueRedis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  
  /**
   * CRITICAL: maxRetriesPerRequest must be null for BullMQ
   * 
   * Why?
   * - BullMQ uses blocking commands (BRPOP)
   * - These commands wait for data
   * - Setting a retry limit breaks BullMQ
   */
  maxRetriesPerRequest: null,
  
  /**
   * Disable offline queue for BullMQ
   * 
   * Why?
   * - If Redis is down, queue should fail fast
   * - Queueing commands in memory is dangerous
   * - Could lead to data loss
   */
  enableOfflineQueue: false,
});

/**
 * Event Listeners for Main Redis Client
 */
redisClient.on('connect', () => {
  console.log('✓ Redis (cache) connected');
});

redisClient.on('ready', () => {
  console.log('✓ Redis (cache) ready to accept commands');
});

redisClient.on('error', (err) => {
  console.error('✗ Redis (cache) error:', err);
  // In production: send to error tracking
});

redisClient.on('close', () => {
  console.log('Redis (cache) connection closed');
});

redisClient.on('reconnecting', () => {
  console.log('Redis (cache) reconnecting...');
});

/**
 * Event Listeners for Queue Redis Client
 */
queueRedis.on('connect', () => {
  console.log('✓ Redis (queue) connected');
});

queueRedis.on('error', (err) => {
  console.error('✗ Redis (queue) error:', err);
  // Critical! Queue not working
});

/**
 * Health Check for Redis
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG';
  } catch (error) {
    console.error('Redis health check failed:', error);
    return false;
  }
}

/**
 * Graceful Shutdown
 * 
 * Close both Redis connections cleanly
 */
export async function closeRedis(): Promise<void> {
  await redisClient.quit();
  await queueRedis.quit();
  console.log('✓ Redis connections closed');
}

// Handle termination signals
process.on('SIGINT', async () => {
  await closeRedis();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeRedis();
  process.exit(0);
});
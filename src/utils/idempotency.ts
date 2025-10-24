import crypto from 'crypto';
import { redisClient } from '../config/redis';

/**
 * Generate Idempotency Key
 */
export function generateIdempotencyKey(
  userId: string,
  template: string,
  data: Record<string, any>
): string {
  /**
   * Step 1: Create deterministic string
   */
  const content = `${userId}:${template}:${JSON.stringify(data)}`;
  
  /**
   * Step 2: Hash the string
   * 
   * createHash('sha256'): Create hasher
   * update(content): Feed data to hasher
   * digest('hex'): Output as hexadecimal string
   */
  const hash = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
  
  return hash;
}

/**
 * Check Idempotency
 * 
 * Have we seen this request before?
 * Returns notification ID if exists, null if new
 * 
 * Why check Redis instead of database?
 * - Redis is MUCH faster (< 1ms vs 10-50ms)
 * - Database is for long-term storage
 * - Redis is for quick lookups
 */
export async function checkIdempotency(
  key: string
): Promise<string | null> {
  /**
   * Redis GET command
   * 
   * Key format: "idempotency:{hash}"
   * Value: notification ID
   * 
   * Example:
   * Key: idempotency:a3f5b2c...
   * Value: "550e8400-e29b-41d4-a716-446655440000"
   */
  const existingId = await redisClient.get(`idempotency:${key}`);
  
  if (existingId) {
    console.log(`Duplicate request detected for key ${key.substring(0, 8)}...`);
  }
  
  return existingId;
}

/**
 * Store Idempotency Key
 * 
 * Remember this notification for future duplicate checks
 * 
 * Why 24-hour TTL?
 * - Prevents Redis from growing forever
 * - 24 hours is enough for most retry scenarios
 * - After 24h, same request creates new notification
 * - Balances memory usage vs protection
 * 
 * What is TTL?
 * - Time To Live
 * - After TTL expires, Redis automatically deletes the key
 * - No manual cleanup needed
 */
export async function storeIdempotencyKey(
  key: string,
  notificationId: string,
  ttlSeconds: number = 86400 // 24 hours default
): Promise<void> {
  /**
   * Redis SETEX command
   * 
   * SET with EXpiration
   * - Sets key-value pair
   * - Automatically expires after ttlSeconds
   * 
   * Parameters:
   * 1. key: idempotency:{hash}
   * 2. ttlSeconds: 86400 (24 hours)
   * 3. value: notification ID
   */
  await redisClient.setex(
    `idempotency:${key}`,
    ttlSeconds,
    notificationId
  );
}

/**
 * Delete Idempotency Key
 * 
 * Manually remove idempotency key from cache
 * 
 * When to use?
 * - After permanent failure (allow retry with new request)
 * - During testing/debugging
 * - Rarely needed in production
 */
export async function deleteIdempotencyKey(key: string): Promise<void> {
  await redisClient.del(`idempotency:${key}`);
}

/**
 * Get All Idempotency Keys (for debugging)
 * 
 * List all active idempotency keys
 * Useful for monitoring cache size
 */
export async function getAllIdempotencyKeys(): Promise<string[]> {
  /**
   * Redis KEYS command
   * 
   * WARNING: KEYS is slow on large databases!
   * - Scans entire Redis database
   * - Blocks other operations
   * - Use only in development or with small datasets
   * 
   * Production alternative: Use SCAN instead
   */
  const keys = await redisClient.keys('idempotency:*');
  return keys;
}

/**
 * Clear All Idempotency Keys (for testing)
 * 
 * Delete all cached idempotency keys
 * Use only in development/testing
 */
export async function clearAllIdempotencyKeys(): Promise<number> {
  const keys = await getAllIdempotencyKeys();
  
  if (keys.length === 0) {
    return 0;
  }
  
  /**
   * Redis DEL command with multiple keys
   * 
   * More efficient than deleting one by one
   * Returns number of keys deleted
   */
  const deletedCount = await redisClient.del(...keys);
  console.log(`Cleared ${deletedCount} idempotency keys`);
  
  return deletedCount;
}
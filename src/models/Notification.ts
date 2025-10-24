/**
 * Notification Model
 * Purpose: Database operations for notifications
 */

import { pool } from '../config/database';
import { 
  Notification, 
  CreateNotificationDTO, 
  NotificationStatus 
} from '../types';
import { NotFoundError } from '../middleware/errorHandler';

/**
 * Notification Model Class
 * 
 * Static methods (no need to instantiate)
 * Each method = one database operation
 */
export class NotificationModel {
  
  /**
   * CREATE - Insert new notification
   * 
   * Purpose: Save notification to database
   * 
   * Parameters:
   * - dto: Data from API request
   * - idempotencyKey: Hash for duplicate detection
   * 
   * Returns: Complete notification object with generated ID
   * 
   * SQL Explanation:
   * INSERT INTO notifications (...) VALUES ($1, $2, ...)
   * RETURNING * → Returns the inserted row
   * 
   * Why RETURNING *?
   * - Gets generated ID without separate SELECT
   * - Gets default values (created_at, etc.)
   * - Single database round-trip
   */
  static async create(
    dto: CreateNotificationDTO,
    idempotencyKey: string
  ): Promise<Notification> {
    /**
     * SQL Query with parameterized values
     * 
     * Why $1, $2, $3 instead of string concatenation?
     * - Prevents SQL injection attacks
     * - Automatic type conversion
     * - Query plan caching (performance)
     */
    const query = `
      INSERT INTO notifications (
        user_id,
        channel,
        template_id,
        data,
        status,
        idempotency_key
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    /**
     * Query parameters
     * 
     * Array index corresponds to $ numbers:
     * $1 = dto.user_id
     * $2 = dto.channel
     * $3 = dto.template
     * $4 = JSON.stringify(dto.data) → PostgreSQL JSONB
     * $5 = 'pending' → Initial status
     * $6 = idempotencyKey
     */
    const values = [
      dto.user_id,
      dto.channel,
      dto.template,
      JSON.stringify(dto.data),      // Convert object to JSON string
      NotificationStatus.PENDING,     // Always start as pending
      idempotencyKey,
    ];
    
    /**
     * Execute query
     */
    const result = await pool.query(query, values);
    
    /**
     * Parse and return notification
     * 
     * Why parseNotification?
     * - PostgreSQL returns some fields as strings
     * - Need to parse JSONB back to objects
     * - Convert timestamps to Date objects
     * - Type-safe return value
     */
    return this.parseNotification(result.rows[0]);
  }
  
  /**
   * FIND BY ID - Get notification by ID
   * 
   * Purpose: Retrieve single notification
   * Used by: GET /api/notifications/:id
   * 
   * Returns: Notification if found
   * Throws: NotFoundError if not found
   */
  static async findById(id: string): Promise<Notification> {
    /**
     * SELECT query
     * 
     * WHERE id = $1 → Find specific notification
     * LIMIT 1 → Optimization (stop after finding one)
     */
    const query = `
      SELECT * FROM notifications
      WHERE id = $1
      LIMIT 1
    `;
    
    const result = await pool.query(query, [id]);
    
    /**
     * Check if notification exists
     * 
     * result.rows.length === 0 means no match found
     */
    if (result.rows.length === 0) {
      throw new NotFoundError(`Notification with ID ${id} not found`);
    }
    
    return this.parseNotification(result.rows[0]);
  }
  
  /**
   * FIND BY IDEMPOTENCY KEY
   * 
   * Purpose: Check if notification already exists (duplicate detection)
   * 
   * Used during notification creation:
   * 1. Generate idempotency key
   * 2. Check if key exists in database
   * 3. If exists: return existing notification
   * 4. If not: create new notification
   * 
   * Returns: Notification if found, null if not
   */
  static async findByIdempotencyKey(key: string): Promise<Notification | null> {
    const query = `
      SELECT * FROM notifications
      WHERE idempotency_key = $1
      LIMIT 1
    `;
    
    const result = await pool.query(query, [key]);
    
    /**
     * Return null instead of throwing error
     * 
     * Why?
     * - Not finding a key is expected (most requests are unique)
     * - Caller uses null check, not try-catch
     * - More readable: if (notification) vs try-catch
     */
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.parseNotification(result.rows[0]);
  }
  
  /**
   * UPDATE STATUS - Change notification status
   * 
   * Purpose: Track notification lifecycle
   * 
   * Status flow:
   * pending → queued → processing → sent/failed
   * 
   * Used by:
   * - API: pending → queued (after adding to queue)
   * - Worker: queued → processing (when starting)
   * - Worker: processing → sent (on success)
   * - Worker: processing → failed/retrying (on failure)
   * 
   * Parameters:
   * - id: Which notification
   * - status: New status
   * - errorMessage: Optional error details (for failures)
   */
  static async updateStatus(
    id: string,
    status: NotificationStatus,
    errorMessage?: string
  ): Promise<Notification> {
    /**
     * UPDATE query
     * 
     * SET multiple columns:
     * - status = new status
     * - error_message = error details (or NULL)
     * - updated_at = current timestamp
     * 
     * WHERE id = $1 → Update specific notification
     * RETURNING * → Return updated row
     */
    const query = `
      UPDATE notifications
      SET 
        status = $2,
        error_message = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    
    const values = [id, status, errorMessage || null];
    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      throw new NotFoundError(`Notification with ID ${id} not found`);
    }
    
    return this.parseNotification(result.rows[0]);
  }
  
  /**
   * INCREMENT RETRY COUNT
   * 
   * Purpose: Track how many times we've retried
   * 
   * Used by: Worker when retrying failed delivery
   * 
   * Why track retry count?
   * - Stop after max retries (prevent infinite loop)
   * - Logging/analytics
   * - Different handling based on attempt number
   */
  static async incrementRetryCount(id: string): Promise<Notification> {
    /**
     * UPDATE with increment
     * 
     * retry_count = retry_count + 1
     * - Atomic operation (no race condition)
     * - Current value + 1
     * 
     * Alternative (BAD):
     * 1. SELECT retry_count
     * 2. Calculate new_count = old_count + 1
     * 3. UPDATE retry_count = new_count
     * Problem: Race condition if two workers update simultaneously
     * 
     * Our way (GOOD):
     * - Single atomic operation
     * - Database handles concurrency
     */
    const query = `
      UPDATE notifications
      SET 
        retry_count = retry_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      throw new NotFoundError(`Notification with ID ${id} not found`);
    }
    
    return this.parseNotification(result.rows[0]);
  }
  
  /**
   * FIND BY USER - Get all notifications for a user
   * 
   * Purpose: User notification history
   * 
   * Parameters:
   * - userId: Which user
   * - limit: Max results (pagination)
   * - offset: Skip N results (pagination)
   * 
   * Example pagination:
   * Page 1: limit=10, offset=0  → Results 1-10
   * Page 2: limit=10, offset=10 → Results 11-20
   * Page 3: limit=10, offset=20 → Results 21-30
   */
  static async findByUser(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Notification[]> {
    /**
     * SELECT with ORDER BY and LIMIT/OFFSET
     * 
     * ORDER BY created_at DESC
     * - DESC = Descending (newest first)
     * - Chronological order
     * 
     * LIMIT $2
     * - Maximum number of results
     * - Prevents returning millions of rows
     * 
     * OFFSET $3
     * - Skip first N rows
     * - For pagination
     */
    const query = `
      SELECT * FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    
    const result = await pool.query(query, [userId, limit, offset]);
    
    /**
     * Map each row to parsed notification
     * 
     * Why map?
     * - Returns array of notifications
     * - Each needs parsing (JSONB, dates, etc.)
     */
    return result.rows.map(row => this.parseNotification(row));
  }
  
  /**
   * COUNT BY STATUS - Get count for monitoring
   * 
   * Purpose: System health metrics
   * 
   * Example use cases:
   * - Dashboard: "50 pending, 100 queued, 500 sent today"
   * - Alerting: If failed > 100, page on-call
   * - Analytics: Success rate over time
   */
  static async countByStatus(status: NotificationStatus): Promise<number> {
    /**
     * COUNT query
     * 
     * COUNT(*) → Count all rows that match WHERE clause
     * 
     * Why COUNT(*) instead of COUNT(id)?
     * - COUNT(*) is optimized by PostgreSQL
     * - Both give same result for non-null PK
     * - COUNT(*) is standard practice
     */
    const query = `
      SELECT COUNT(*) as count
      FROM notifications
      WHERE status = $1
    `;
    
    const result = await pool.query(query, [status]);
    
    /**
     * Parse count from result
     * 
     * PostgreSQL returns count as string
     * parseInt converts to number
     * result.rows[0].count → Access count column
     */
    return parseInt(result.rows[0].count, 10);
  }
  
  /**
   * DELETE - Remove notification (rarely used)
   * 
   * Purpose: Data cleanup, testing
   * 
   * WARNING: In production, usually don't delete
   * - Archive instead
   * - Soft delete (add deleted_at column)
   * - Keep for compliance/auditing
   * 
   * This is mainly for development/testing
   */
  static async delete(id: string): Promise<void> {
    /**
     * DELETE query
     * 
     * ON DELETE CASCADE (from schema)
     * - Automatically deletes related delivery_logs
     * - Maintains referential integrity
     */
    const query = `
      DELETE FROM notifications
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    /**
     * Check if notification existed
     * 
     * rowCount = 0 means nothing was deleted
     * Likely notification ID doesn't exist
     */
    if (result.rowCount === 0) {
      throw new NotFoundError(`Notification with ID ${id} not found`);
    }
  }
  
  /**
   * PARSE NOTIFICATION - Convert database row to typed object
   * 
   * Purpose: Data transformation
   * 
   * Why needed?
   * - PostgreSQL returns JSONB as string
   * - Timestamps as string, need Date objects
   * - Ensure type safety
   * - Handle null values
   * 
   * This is a private helper (not used outside this class)
   */
  private static parseNotification(row: any): Notification {
    return {
      id: row.id,
      user_id: row.user_id,
      channel: row.channel,
      template_id: row.template_id,
      
      /**
       * Parse JSON data
       * 
       * row.data might be:
       * - String (from PostgreSQL): '{"name":"John"}'
       * - Object (already parsed): {name:"John"}
       * 
       * typeof check handles both cases
       */
      data: typeof row.data === 'string' 
        ? JSON.parse(row.data) 
        : row.data,
      
      status: row.status,
      idempotency_key: row.idempotency_key,
      error_message: row.error_message,
      retry_count: row.retry_count,
      
      /**
       * Parse timestamps
       * 
       * new Date(string) → Date object
       * 
       * Why Date objects?
       * - Can do date arithmetic
       * - Can format for display
       * - Type-safe operations
       */
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
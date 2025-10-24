/**
 * DeliveryLog Model
 * 
 * Purpose: Track delivery attempts and outcomes
 * 
 * Why separate from notifications table?
 * - One notification can have multiple attempts
 * - Keeps notifications table lean
 * - Better query performance
 * - Detailed debugging information
 * 
 * Use cases:
 * - Debugging: "Why did this notification fail?"
 * - Analytics: "What's our delivery success rate?"
 * - Monitoring: "Is Twilio having issues?"
 * - Compliance: Audit trail of all attempts
 */

import { pool } from '../config/database';
import { DeliveryLog, NotificationStatus } from '../types';

export class DeliveryLogModel {
  
  /**
   * CREATE - Log a delivery attempt
   * 
   * Purpose: Record what happened during send attempt
   * 
   * Called by: Worker after each send attempt (success or failure)
   * 
   * Parameters:
   * - notificationId: Which notification
   * - attempt: Attempt number (1, 2, 3...)
   * - status: Result ('sent', 'failed', 'retrying')
   * - errorMessage: Error details if failed
   * - providerResponse: Raw response from SendGrid/Twilio
   * 
   * Example providerResponse:
   * {
   *   messageId: "abc123",
   *   status: "queued",
   *   to: "user@example.com",
   *   timestamp: "2024-01-15T10:30:00Z"
   * }
   */
  static async create(
    notificationId: string,
    attempt: number,
    status: NotificationStatus,
    errorMessage?: string,
    providerResponse?: Record<string, any>
  ): Promise<DeliveryLog> {
    /**
     * INSERT delivery log
     * 
     * Foreign key constraint:
     * - notification_id REFERENCES notifications(id)
     * - If notification deleted, logs auto-delete (CASCADE)
     */
    const query = `
      INSERT INTO delivery_logs (
        notification_id,
        attempt,
        status,
        error_message,
        provider_response
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    
    const values = [
      notificationId,
      attempt,
      status,
      errorMessage || null,
      providerResponse ? JSON.stringify(providerResponse) : null,
    ];
    
    const result = await pool.query(query, values);
    
    return this.parseDeliveryLog(result.rows[0]);
  }
  
  /**
   * FIND BY NOTIFICATION - Get all attempts for a notification
   * 
   * Purpose: See full delivery history
   * 
   * Example output:
   * [
   *   { attempt: 1, status: 'failed', error: 'Network timeout' },
   *   { attempt: 2, status: 'failed', error: 'Rate limited' },
   *   { attempt: 3, status: 'sent', error: null }
   * ]
   * 
   * Ordered by attempt number (chronological)
   */
  static async findByNotification(notificationId: string): Promise<DeliveryLog[]> {
    /**
     * SELECT all logs for notification
     * 
     * ORDER BY attempt ASC
     * - Chronological order
     * - See retry progression
     */
    const query = `
      SELECT * FROM delivery_logs
      WHERE notification_id = $1
      ORDER BY attempt ASC
    `;
    
    const result = await pool.query(query, [notificationId]);
    
    return result.rows.map(row => this.parseDeliveryLog(row));
  }
  
  /**
   * FIND LATEST - Get most recent attempt
   * 
   * Purpose: Quick check of last attempt status
   * 
   * Used by: Status endpoint to show latest error
   */
  static async findLatest(notificationId: string): Promise<DeliveryLog | null> {
    /**
     * SELECT most recent log
     * 
     * ORDER BY created_at DESC
     * - Newest first
     * 
     * LIMIT 1
     * - Only need most recent
     */
    const query = `
      SELECT * FROM delivery_logs
      WHERE notification_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const result = await pool.query(query, [notificationId]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return this.parseDeliveryLog(result.rows[0]);
  }
  
  /**
   * COUNT BY STATUS - Analytics
   * 
   * Purpose: Delivery success metrics
   * 
   * Example queries:
   * - "How many deliveries succeeded today?"
   * - "What's our failure rate?"
   * - "Is SendGrid having issues?" (spike in failures)
   * 
   * Parameters:
   * - status: Which status to count
   * - since: Optional start date (for time-based metrics)
   */
  static async countByStatus(
    status: NotificationStatus,
    since?: Date
  ): Promise<number> {
    /**
     * COUNT with optional date filter
     * 
     * Build query conditionally:
     * - Always: WHERE status = $1
     * - Sometimes: AND created_at >= $2
     */
    let query = `
      SELECT COUNT(*) as count
      FROM delivery_logs
      WHERE status = $1
    `;
    
    const values: any[] = [status];
    
    if (since) {
      query += ` AND created_at >= $2`;
      values.push(since);
    }
    
    const result = await pool.query(query, values);
    
    return parseInt(result.rows[0].count, 10);
  }
  
  /**
   * GET SUCCESS RATE - Calculate delivery success rate
   * 
   * Purpose: Monitor system health
   * 
   * Returns: Percentage (0-100)
   * 
   * Example:
   * 950 sent, 50 failed
   * Success rate = 950 / 1000 = 95%
   * 
   * Parameters:
   * - since: Optional start date (e.g., last 24 hours)
   */
  static async getSuccessRate(since?: Date): Promise<number> {
    /**
     * Calculate success rate with SQL
     * 
     * COUNT(CASE WHEN status = 'sent' THEN 1 END)
     * - Counts only 'sent' status
     * - CASE returns 1 for sent, NULL for others
     * - COUNT ignores NULLs
     * 
     * COUNT(*) AS total
     * - Total attempts
     * 
     * Division in PostgreSQL:
     * - ::FLOAT casts to floating point
     * - Without cast, integer division (95.5 becomes 95)
     */
    let query = `
      SELECT 
        COUNT(CASE WHEN status = 'sent' THEN 1 END)::FLOAT AS sent,
        COUNT(*)::FLOAT AS total
      FROM delivery_logs
    `;
    
    const values: any[] = [];
    
    if (since) {
      query += ` WHERE created_at >= $1`;
      values.push(since);
    }
    
    const result = await pool.query(query, values);
    
    const sent = parseFloat(result.rows[0].sent);
    const total = parseFloat(result.rows[0].total);
    
    /**
     * Handle edge case: no attempts yet
     */
    if (total === 0) {
      return 0;
    }
    
    /**
     * Calculate percentage
     * (sent / total) * 100
     * Round to 2 decimal places
     */
    return Math.round((sent / total) * 100 * 100) / 100;
  }
  
  /**
   * PARSE DELIVERY LOG - Type conversion
   * 
   * Private helper
   */
  private static parseDeliveryLog(row: any): DeliveryLog {
    return {
      id: row.id,
      notification_id: row.notification_id,
      attempt: row.attempt,
      status: row.status,
      error_message: row.error_message,
      
      /**
       * Parse provider_response JSONB
       */
      provider_response: row.provider_response
        ? (typeof row.provider_response === 'string'
            ? JSON.parse(row.provider_response)
            : row.provider_response)
        : undefined,
      
      created_at: new Date(row.created_at),
    };
  }
}
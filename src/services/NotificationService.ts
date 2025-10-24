/**
 * Notification Service
 * 
 * Purpose: Business logic layer for notifications
 * 
 * Why a service layer?
 * - Routes should be thin (just HTTP handling)
 * - Models should be simple (just database ops)
 * - Service contains business logic (orchestration)
 * 
 * Responsibilities:
 * - Validate business rules
 * - Coordinate between models
 * - Handle transactions
 * - Queue jobs
 * - Cache management
 * 
 * Pattern: Service Layer Pattern
 */

import { NotificationModel } from '../models/Notification';
import { TemplateModel } from '../models/Template';
import { notificationQueue } from '../config/queue';
import { redisClient } from '../config/redis';
import {
  CreateNotificationDTO,
  Notification,
  NotificationJobData,
  NotificationStatus,
  NotificationChannel,
} from '../types';
import {
  generateIdempotencyKey,
  checkIdempotency,
  storeIdempotencyKey,
} from '../utils/idempotency';
import { BadRequestError, NotFoundError } from '../middleware/errorHandler';
import { stat } from 'fs';

export class NotificationService {
  
  /**
   * CREATE NOTIFICATION
   * 
   * Main service method - handles full notification creation flow
   * 
   * Flow:
   * 1. Generate idempotency key
   * 2. Check if duplicate (Redis cache)
   * 3. Check if duplicate (Database fallback)
   * 4. Validate template exists
   * 5. Validate template variables
   * 6. Save notification to database
   * 7. Add job to queue
   * 8. Cache idempotency key
   * 9. Return notification
   * 
   * Why this order?
   * - Fast checks first (Redis)
   * - Fail fast on validation errors
   * - Database operations last (most expensive)
   * 
   * Parameters:
   * - dto: Notification data from API
   * 
   * Returns: Created notification object
   */
  static async createNotification(
    dto: CreateNotificationDTO
  ): Promise<Notification> {
    /**
     * Step 1: Generate Idempotency Key
     * 
     * Create unique hash from request data
     * Same request → Same key
     * 
     * Why generate key ourselves?
     * - Client might not send one
     * - We control the format
     * - Consistent hashing algorithm
     */
    const idempotencyKey = generateIdempotencyKey(
      dto.user_id,
      dto.template,
      dto.data
    );
    
    console.log(`Processing notification for user ${dto.user_id}, key: ${idempotencyKey.substring(0, 8)}...`);
    
    /**
     * Step 2: Check Redis Cache for Duplicate
     * 
     * Redis is fast (< 1ms)
     * Check here first before hitting database
     * 
     * Why check Redis before database?
     * - 10-50x faster
     * - Reduces database load
     * - Most duplicates are recent (in cache)
     */
    const cachedNotificationId = await checkIdempotency(idempotencyKey);
    
    if (cachedNotificationId) {
      console.log(`Duplicate request detected (Redis cache), returning existing notification ${cachedNotificationId}`);
      
      /**
       * Return existing notification
       * 
       * This is idempotency in action:
       * - Client makes same request twice
       * - Gets same notification both times
       * - No duplicate send
       */
      return await NotificationModel.findById(cachedNotificationId);
    }
    
    /**
     * Step 3: Check Database for Duplicate
     * 
     * Why also check database?
     * - Redis might have evicted the key (TTL expired)
     * - Redis might have been cleared
     * - Database is source of truth
     * 
     * This is defense in depth:
     * - Redis: Fast, temporary
     * - Database: Slower, permanent
     */
    const existingNotification = await NotificationModel.findByIdempotencyKey(
      idempotencyKey
    );
    
    if (existingNotification) {
      console.log(`Duplicate request detected (Database), returning existing notification ${existingNotification.id}`);
      
      /**
       * Cache it for next time
       * 
       * Re-populate Redis cache
       * Next duplicate will be caught by Redis
       */
      await storeIdempotencyKey(idempotencyKey, existingNotification.id);
      
      return existingNotification;
    }
    
    /**
     * Step 4: Validate Template Exists
     * 
     * Check template before creating notification
     * Fail fast if template doesn't exist
     * 
     * Why check here and not in worker?
     * - Give immediate feedback to client
     * - Don't waste queue space
     * - Don't create orphan notifications
     */
    let template;
    try {
      template = await TemplateModel.findById(dto.template);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new BadRequestError(`Template '${dto.template}' not found`);
      }
      throw error;
    }
    
    /**
     * Step 5: Validate Channel Matches
     * 
     * Ensure requested channel matches template channel
     * 
     * Example error:
     * - Request: channel=sms, template=welcome_email
     * - Template welcome_email is for email, not SMS
     * - Reject request
     * 
     * Why enforce this?
     * - SMS templates are short (160 chars)
     * - Email templates have HTML, subject
     * - Push templates have title, body
     * - Can't use email template for SMS
     */
    if (template.channel !== dto.channel) {
      throw new BadRequestError(
        `Template '${dto.template}' is for ${template.channel}, not ${dto.channel}`
      );
    }
    
    /**
     * Step 6: Validate Template Variables
     * 
     * Check if data has all required variables
     * 
     * Example:
     * Template needs: ['name', 'link']
     * Data has: {name: 'John'} ← Missing 'link'!
     * 
     * Why validate here?
     * - Immediate feedback to client
     * - Don't queue invalid notifications
     * - Worker doesn't need to validate
     */
    const validation = TemplateModel.validateVariables(template, dto.data);
    
    if (!validation.valid) {
      throw new BadRequestError(
        `Missing required template variables: ${validation.missingVars.join(', ')}`
      );
    }
    
    /**
     * Step 7: Save Notification to Database
     * 
     * Create database record with status='pending'
     * 
     * Why save before queueing?
     * - Get notification ID
     * - Queue only stores ID (not full data)
     * - If queue fails, notification still exists (can retry)
     * - Audit trail (notification created at X time)
     */
    const notification = await NotificationModel.create(dto, idempotencyKey);
    
    console.log(`Created notification ${notification.id}`);
    
    /**
     * Step 8: Add Job to Queue
     * 
     * Queue the notification for async processing
     * 
     * Job data:
     * - Just the notification ID
     * - Worker will fetch full data from database
     * 
     * Why only ID in queue?
     * - Keeps queue lightweight
     * - Source of truth is database
     * - Easy to retry (just re-queue ID)
     * 
     * Queue options:
     * - attempts: 3 (retry up to 3 times)
     * - backoff: exponential (wait longer each retry)
     * - removeOnComplete: true (clean up old jobs)
     */
    const jobData: NotificationJobData = {
      notificationId: notification.id,
    };
    
    await notificationQueue.add('send-notification', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000, // Start with 2 seconds, then 4s, 8s
      },
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs for debugging
    });
    
    console.log(`Queued notification ${notification.id} for processing`);
    
    /**
     * Step 9: Cache Idempotency Key
     * 
     * Store in Redis for fast duplicate detection
     * 
     * TTL: 24 hours
     * - Long enough for most duplicate scenarios
     * - Short enough to not waste memory
     * 
     * Why cache AFTER queueing?
     * - If queueing fails, no cache entry
     * - Next request will retry properly
     * - Avoids "cached but not queued" state
     */
    await storeIdempotencyKey(idempotencyKey, notification.id);
    
    return notification;
  }
  
  /**
   * GET NOTIFICATION BY ID
   * 
   * Retrieve notification status and details
   * 
   * Use cases:
   * - Client polling for status updates
   * - Dashboard showing notification history
   * - Debugging failed notifications
   * 
   * Returns: Notification with current status
   */
  static async getNotificationById(id: string): Promise<Notification> {
    return await NotificationModel.findById(id);
  }
  
  /**
   * UPDATE NOTIFICATION STATUS
   * 
   * Called by worker after processing
   * 
   * Updates:
   * - Status (sent, failed, etc.)
   * - Error message (if failed)
   * - Updated timestamp
   * 
   * Why separate method?
   * - Workers shouldn't call NotificationModel directly
   * - Allows adding logic (webhooks, logging, etc.)
   * - Can add authorization checks
   */
  static async updateNotificationStatus(
    id: string,
    status: NotificationStatus,
    errorMessage?: string
  ): Promise<Notification> {
    const updateData: Partial<Notification> = {
      status,
      error_message: errorMessage || undefined,
      updated_at: new Date(),
    };
    
    const notification = await NotificationModel.updateStatus(id, status);
    
    console.log(`Updated notification ${id} to status: ${status}`);
    
    return notification;
  }
  
  /**
   * GET USER NOTIFICATIONS
   * 
   * Retrieve all notifications for a user
   * 
   * Useful for:
   * - User notification inbox
   * - Notification history
   * - Analytics
   * 
   * Parameters:
   * - userId: User to get notifications for
   * - limit: Max results (pagination)
   * - offset: Skip results (pagination)
   * 
   * Returns: Array of notifications
   */
  static async getUserNotifications(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Notification[]> {
    return await NotificationModel.findByUser(userId, limit, offset);
  }
  
  /**
   * RETRY FAILED NOTIFICATION
   * 
   * Manually retry a failed notification
   * 
   * Use cases:
   * - Admin dashboard retry button
   * - Scheduled retry job
   * - API endpoint for retrying
   * 
   * Steps:
   * 1. Verify notification exists and is failed
   * 2. Reset status to pending
   * 3. Re-queue for processing
   * 
   * Returns: Updated notification
   */
  static async retryFailedNotification(id: string): Promise<Notification> {
    const notification = await NotificationModel.findById(id);
    
    if (notification.status !== NotificationStatus.FAILED) {
      throw new BadRequestError(
        `Cannot retry notification with status: ${notification.status}`
      );
    }
    
    // Reset to retrying status
    await NotificationModel.updateStatus(id, 
      NotificationStatus.RETRYING,
    undefined,);
    
    // Re-queue
    const jobData: NotificationJobData = {
      notificationId: id,
    };
    
    await notificationQueue.add('send-notification', jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });
    
    console.log(`Retrying notification ${id}`);
    
    return await NotificationModel.findById(id);
  }
  
  /**
   * INCREMENT RETRY COUNT
   * 
   * Track how many times we've attempted to send this notification
   * 
   * Called by worker before each retry attempt
   * 
   * Returns: Updated notification
   */
  static async incrementRetryCount(id: string): Promise<Notification> {
    const notification = await NotificationModel.findById(id);
    
    const updateData: Partial<Notification> = {
      retry_count: notification.retry_count + 1,
      status: NotificationStatus.RETRYING,
      updated_at: new Date(),
    };
    
    return await NotificationModel.updateStatus(id,  NotificationStatus.RETRYING);
  }

  static async getQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      notificationQueue.getWaitingCount(),
      notificationQueue.getActiveCount(),
      notificationQueue.getCompletedCount(),
      notificationQueue.getFailedCount(),
    ]);
    
    return {
      waiting,
      active,
      completed,
      failed,
      total: waiting + active + completed + failed,
    };
  }
}
/**
 * Notification Routes
 * 
 * Purpose: Define HTTP endpoints for notification API
 * 
 * Why separate routes file?
 * - Keep app.ts clean
 * - Group related endpoints
 * - Easy to add new routes
 * - Clear API structure
 */

import { Router, Request, Response } from 'express';
import { NotificationService } from '../services/NotificationService';
import { validate, createNotificationSchema, validateUUID } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';
import { CreateNotificationDTO } from '../types';

const router = Router();

/**
 * POST /api/notifications
 * 
 * Create new notification
 * 
 * Request body:
 * {
 *   "user_id": "123",
 *   "channel": "email",
 *   "template": "welcome_email",
 *   "data": {
 *     "name": "John",
 *     "link": "https://example.com"
 *   }
 * }
 * 
 * Response: 202 Accepted
 * {
 *   "success": true,
 *   "message": "Notification queued for processing",
 *   "data": {
 *     "id": "uuid",
 *     "status": "queued"
 *   }
 * }
 * 
 * Why 202 Accepted instead of 200 OK?
 * - 202 = Request accepted but not yet processed
 * - Accurate for async operations
 * - Indicates notification is queued, not sent
 */
router.post(
  '/',
  validate(createNotificationSchema),  // Validate request body
  asyncHandler(async (req: Request, res: Response) => {
    const dto: CreateNotificationDTO = req.body;
    
    /**
     * Call service to create notification
     * 
     * Service handles:
     * - Idempotency check
     * - Template validation
     * - Database save
     * - Queue job
     */
    const notification = await NotificationService.createNotification(dto);
    
    /**
     * Return success response
     * 
     * Status 202: Accepted for processing
     * Client can poll /api/notifications/:id for status
     */
    res.status(202).json({
      success: true,
      message: 'Notification queued for processing',
      data: {
        id: notification.id,
        status: notification.status,
        created_at: notification.created_at,
      },
    });
  })
);

/**
 * GET /api/notifications/:id
 * 
 * Get notification status and details
 * 
 * URL parameter:
 * - id: Notification UUID
 * 
 * Response: 200 OK
 * {
 *   "success": true,
 *   "data": {
 *     "id": "uuid",
 *     "user_id": "123",
 *     "channel": "email",
 *     "template_id": "welcome_email",
 *     "status": "sent",
 *     "created_at": "2024-01-15T10:30:00Z",
 *     "updated_at": "2024-01-15T10:31:00Z"
 *   }
 * }
 * 
 * Use case:
 * - Client polls this endpoint to check if notification was sent
 * - Dashboard shows notification status
 * - Debugging failed notifications
 */
router.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: 'Notification service is healthy',
    timestamp: new Date().toISOString(),
  });
});

router.get(
  '/:id',
  validateUUID,  // Validate ID format
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    
    const notification = await NotificationService.getNotificationById(id);
    
    /**
     * Return notification details
     * 
     * Status 200: Successfully retrieved
     * If not found, validateUUID or service throws NotFoundError (404)
     */
    res.status(200).json({
      success: true,
      data: {
        id: notification.id,
        user_id: notification.user_id,
        channel: notification.channel,
        template_id: notification.template_id,
        status: notification.status,
        error_message: notification.error_message,
        retry_count: notification.retry_count,
        created_at: notification.created_at,
        updated_at: notification.updated_at,
      },
    });
  })
);

/**
 * GET /api/notifications/user/:userId
 * 
 * Get all notifications for a user
 * 
 * URL parameter:
 * - userId: User identifier
 * 
 * Query parameters (optional):
 * - limit: Max results (default: 50)
 * - offset: Pagination offset (default: 0)
 * 
 * Example: GET /api/notifications/user/123?limit=10&offset=20
 * 
 * Response: Array of notifications
 */
router.get(
  '/user/:userId',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    /**
     * Validate pagination parameters
     */
    if (limit < 1 || limit > 100) {
      return res.status(400).json({
        success: false,
        error: 'Limit must be between 1 and 100',
      });
    }
    
    if (offset < 0) {
      return res.status(400).json({
        success: false,
        error: 'Offset must be non-negative',
      });
    }
    
    const notifications = await NotificationService.getUserNotifications(
      userId,
      limit,
      offset
    );
    
    res.status(200).json({
      success: true,
      data: notifications,
      pagination: {
        limit,
        offset,
        count: notifications.length,
      },
    });
  })
);

/**
 * GET /api/notifications/stats/queue
 * 
 * Get queue statistics (system health)
 * 
 * Response:
 * {
 *   "success": true,
 *   "data": {
 *     "waiting": 10,
 *     "active": 5,
 *     "completed": 1000,
 *     "failed": 50,
 *     "total": 1065
 *   }
 * }
 * 
 * Use case:
 * - Monitoring dashboard
 * - Health checks
 * - Alerting (if queue backs up)
 */
router.get(
  '/stats/queue',
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await NotificationService.getQueueStats();
    
    res.status(200).json({
      success: true,
      data: stats,
    });
  })
);

/**
 * Health Check Endpoint
 * 
 * GET /api/notifications/health
 * 
 * Quick check if service is alive
 * Used by load balancers, monitoring tools
 */


export default router;
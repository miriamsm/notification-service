import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { NotificationChannel } from '../types';

/**
 * Create Notification Schema
 * 
 * Defines what a valid notification request looks like
 */
export const createNotificationSchema = Joi.object({
  /**
   * user_id field
   * 
   * Rules:
   * - string(): Must be a string
   * - trim(): Remove leading/trailing whitespace
   * - min(1): At least 1 character
   * - max(255): Maximum 255 characters (database limit)
   * - required(): Field must be present
   * 
   * Example valid: "user123", "abc-def-ghi"
   * Example invalid: "", 123 (number), null, undefined
   */
  user_id: Joi.string()
    .trim()
    .min(1)
    .max(255)
    .required()
    .messages({
      'string.base': 'user_id must be a string',
      'string.empty': 'user_id cannot be empty',
      'string.min': 'user_id must be at least 1 character',
      'string.max': 'user_id cannot exceed 255 characters',
      'any.required': 'user_id is required',
    }),
  
  /**
   * channel field
   * 
   * Rules:
   * - string(): Must be a string
   * - valid(): Must be one of specified values
   * - required(): Must be present
   * 
   * Why use enum values?
   * - Type safety
   * - Clear error messages
   * - Easy to add new channels
   * 
   * Example valid: "email", "sms", "push"
   * Example invalid: "Email" (case matters), "whatsapp", 123
   */
  channel: Joi.string()
    .valid(...Object.values(NotificationChannel))
    .required()
    .messages({
      'string.base': 'channel must be a string',
      'any.only': `channel must be one of: ${Object.values(NotificationChannel).join(', ')}`,
      'any.required': 'channel is required',
    }),
  
  /**
   * template field
   * 
   * Rules:
   * - string(): Must be a string
   * - trim(): Remove whitespace
   * - min(1): Not empty after trimming
   * - max(255): Database limit
   * - required(): Must be present
   * 
   * Example valid: "welcome_email", "order_shipped"
   * Example invalid: "", "  " (only whitespace), very_long_template_name_that_exceeds_limit
   */
  template: Joi.string()
    .trim()
    .min(1)
    .max(255)
    .required()
    .messages({
      'string.base': 'template must be a string',
      'string.empty': 'template cannot be empty',
      'string.min': 'template must be at least 1 character',
      'string.max': 'template cannot exceed 255 characters',
      'any.required': 'template is required',
    }),
  
  /**
   * data field
   * 
   * Rules:
   * - object(): Must be an object (not array, string, etc.)
   * - unknown(true): Allow any keys (template variables are dynamic)
   * - required(): Must be present (even if empty object)
   * 
   * Why allow unknown keys?
   * - Different templates need different variables
   * - welcome_email needs {name, link}
   * - order_shipped needs {name, order_id, tracking_link}
   * - We validate specific variables when rendering template
   * 
   * Example valid: {name: "John", link: "https://example.com"}
   * Example invalid: "string", [], null, undefined
   */
  data: Joi.object()
    .unknown(true)
    .required()
    .messages({
      'object.base': 'data must be an object',
      'any.required': 'data is required',
    }),
});

/**
 * Validation Middleware Factory
 * 
 * Creates Express middleware for any Joi schema
 * 
 * How to use:
 * router.post('/notifications', validate(createNotificationSchema), handler);
 * 
 * What this does:
 * 1. Request comes in
 * 2. Validate middleware runs first
 * 3. If valid: call next() → handler runs
 * 4. If invalid: send 400 error → handler never runs
 */
export function validate(schema: Joi.Schema) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,      // Get all errors
      stripUnknown: false,    // Keep unknown fields
    });
    
    /**
     * If validation failed
     */
    if (error) {
      /**
       * Extract error details
       */
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),    // 'data.name' or just 'user_id'
        message: detail.message,          // Human-readable error
        type: detail.type,                // Error type for programmatic handling
      }));
      
      /**
       * Return 400 Bad Request with detailed errors
       */
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors,
      });
    }
    
    /**
     * If validation succeeded
     * 
     * Replace req.body with validated/sanitized value
     * - Types are correct
     * - Strings are trimmed
     * - Default values applied
     * - Safe to use in handler
     */
    req.body = value;
    
    /**
     * Call next middleware/handler
     */
    next();
  };
}

/**
 * UUID Validation Schema
 * 
 * For validating notification IDs in URLs
 * Example: GET /api/notifications/:id
 */
export const uuidSchema = Joi.string()
  .uuid({ version: 'uuidv4' })
  .required()
  .messages({
    'string.guid': 'Invalid notification ID format',
    'any.required': 'Notification ID is required',
  });

/**
 * Validate UUID Middleware
 * 
 * Validates :id parameter in routes
 * 
 * Usage:
 * router.get('/notifications/:id', validateUUID, handler);
 */
export function validateUUID(req: Request, res: Response, next: NextFunction) {
  const { error } = uuidSchema.validate(req.params.id);
  
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.message,
    });
  }
  
  next();
}
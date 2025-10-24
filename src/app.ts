/**
 * Express Application Setup
 * 
 * Purpose: Configure Express app with middleware and routes
 * 
 * Why separate from server.ts?
 * - Easier to test (can import app without starting server)
 * - Cleaner separation of concerns
 * - Reusable app configuration
 */

import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import notificationRoutes from './routes/notifications';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

/**
 * Create Express Application
 */
export function createApp(): Application {
  const app = express();
  
  /**
   * Security Middleware
   * 
   * helmet() sets various HTTP headers for security:
   * - X-Content-Type-Options: nosniff
   * - X-Frame-Options: DENY
   * - X-XSS-Protection: 1; mode=block
   * - Strict-Transport-Security (HSTS)
   * 
   * Why?
   * - Prevents common attacks (XSS, clickjacking, etc.)
   * - Industry best practice
   * - Easy security win
   */
  app.use(helmet());
  
  /**
   * CORS Middleware
   * 
   * Allow cross-origin requests
   * 
   * Development: Allow all origins
   * Production: Specify allowed origins
   * 
   * Example production config:
   * cors({
   *   origin: ['https://yourapp.com', 'https://admin.yourapp.com'],
   *   credentials: true,
   * })
   */
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));
  
  /**
   * Body Parser Middleware
   * 
   * express.json() parses JSON request bodies
   * 
   * limit: '10mb' prevents huge payloads
   * - Protects against DOS attacks
   * - Most notifications are < 1kb
   * - 10mb is generous
   */
  app.use(express.json({ limit: '10mb' }));
  
  /**
   * URL-encoded parser (for form submissions)
   * 
   * extended: true allows nested objects
   */
  app.use(express.urlencoded({ extended: true }));
  
  /**
   * Request Logging Middleware
   * 
   * Log every incoming request
   * 
   * Production: Use proper logger (Winston, Pino)
   * Development: console.log is fine
   */
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} - ${new Date().toISOString()}`);
    next();
  });
  
  /**
   * Root Endpoint
   * 
   * GET /
   * 
   * API information
   */
  app.get('/', (req, res) => {
    res.json({
      service: 'Notification Service',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        health: '/api/notifications/health',
        create: 'POST /api/notifications',
        get: 'GET /api/notifications/:id',
        userNotifications: 'GET /api/notifications/user/:userId',
        queueStats: 'GET /api/notifications/stats/queue',
      },
      documentation: 'https://github.com/your-repo/notification-service',
    });
  });
  
  /**
   * API Routes
   * 
   * Mount notification routes at /api/notifications
   * 
   * All routes in notificationRoutes will be prefixed:
   * - POST /api/notifications
   * - GET /api/notifications/:id
   * - etc.
   */
  app.use('/api/notifications', notificationRoutes);
  
  /**
   * 404 Not Found Handler
   * 
   * Must come AFTER all routes
   * Catches requests to non-existent endpoints
   */
  app.use(notFoundHandler);
  
  /**
   * Error Handler
   * 
   * Must come LAST
   * Catches all errors from routes and middleware
   * 
   * Must have 4 parameters (err, req, res, next)
   * Express recognizes this as error handler
   */
  app.use(errorHandler);
  
  return app;
}
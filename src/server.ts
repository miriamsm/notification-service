/**
 * API Server
 * 
 * Purpose: Start HTTP server for API
 * 
 * This runs the API that receives notification requests
 * Separate from worker.ts (which processes the queue)
 * 
 * In production:
 * - API server: Multiple instances behind load balancer
 * - Workers: Separate instances/containers
 */

import dotenv from 'dotenv';
import { createApp } from './app';
import { pool, closeDatabase } from './config/database';
import { redisClient, closeRedis } from './config/redis';

// Load environment variables
dotenv.config();

/**
 * Configuration
 */
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * Create Express app
 */
const app = createApp();

/**
 * Start Server
 */
async function startServer() {
  try {
    /**
     * Test database connection
     */
    await pool.query('SELECT NOW()');
    console.log('✓ Database connected');
    
    /**
     * Test Redis connection
     */
    await redisClient.ping();
    console.log('✓ Redis connected');
    
    /**
     * Start HTTP server
     */
    const server = app.listen(PORT, () => {
      console.log('');
      console.log('='.repeat(60));
      console.log(`🚀 Notification Service API`);
      console.log('='.repeat(60));
      console.log(`Environment: ${NODE_ENV}`);
      console.log(`Port: ${PORT}`);
      console.log(`URL: http://localhost:${PORT}`);
      console.log(`Health: http://localhost:${PORT}/api/notifications/health`);
      console.log('='.repeat(60));
      console.log('');
    });
    
    /**
     * Graceful Shutdown
     * 
     * Handle SIGTERM and SIGINT signals
     * - Stop accepting new connections
     * - Finish current requests
     * - Close database connections
     * - Exit cleanly
     */
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down gracefully...`);
      
      // Stop accepting new connections
      server.close(async () => {
        console.log('✓ HTTP server closed');
        
        try {
          // Close database
          await closeDatabase();
          
          // Close Redis
          await closeRedis();
          
          console.log('✓ All connections closed');
          process.exit(0);
        } catch (error) {
          console.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
      
      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };
    
    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Start the server
 */
startServer();
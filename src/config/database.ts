/**
 * Database Configuration for Notification Service
 */

import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';

// Load environment variables from .env file
// Must be called before accessing process.env
dotenv.config();

/**
 * Create PostgreSQL connection pool
 */
export const pool = new Pool({
  // Database server address
  host: process.env.DB_HOST || 'localhost',
  
  // PostgreSQL default port is 5432
  port: parseInt(process.env.DB_PORT || '5432'),
  
  // Database name we created
  database: process.env.DB_NAME || 'notification_service',
  
  // Database credentials
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
  
  // Maximum number of clients in the pool
  // Why 20? Good balance for most apps
  // Too few = bottleneck, Too many = overwhelms database
  max: 20,
  
  // How long a client can remain idle before being closed
  // 30 seconds is standard
  idleTimeoutMillis: 30000,
  
  // How long to wait for a connection before timing out
  // 2 seconds prevents hanging requests
  connectionTimeoutMillis: 2000,
});

/**
 * Event listeners for monitoring
 */
pool.on('connect', (client) => {
  console.log('✓ New database client connected');
});

pool.on('error', (err, client) => {
  console.error('✗ Unexpected database pool error:', err);
  // In production, send to error tracking service (Sentry, Datadog)
});

pool.on('remove', (client) => {
  console.log('Database client removed from pool');
});

/**
 * Transaction Helper Function
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  // Get a dedicated client from the pool
  const client = await pool.connect();
  
  try {
    // BEGIN TRANSACTION
    // Everything after this is tentative until COMMIT
    await client.query('BEGIN');
    
    // Execute the callback (your database operations)
    const result = await callback(client);
    
    // COMMIT TRANSACTION
    // Make all changes permanent
    await client.query('COMMIT');
    
    return result;
  } catch (error) {
    // ROLLBACK TRANSACTION
    // Undo all changes since BEGIN
    await client.query('ROLLBACK');
    
    // Re-throw the error so caller knows it failed
    throw error;
  } finally {
    // ALWAYS release client back to pool
    // Even if there was an error
    // Otherwise we leak connections!
    client.release();
  }
}

/**
 * Health check function
 * 
 * Used by load balancers to check if service is healthy
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    return result.rows.length > 0;
  } catch (error) {
    console.error('Database health check failed:', error);
    return false;
  }
}

/**
 * Graceful shutdown of database pool
 */
export async function closeDatabase(): Promise<void> {
  await pool.end();
  console.log('✓ Database pool closed');
}

// Handle process termination signals
process.on('SIGINT', async () => {
  await closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDatabase();
  process.exit(0);
});
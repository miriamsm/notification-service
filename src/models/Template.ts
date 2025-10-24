/**
 * Template Model
 * 
 * Purpose: Database operations for notification templates
 * 
 * What is a template?
 * - Reusable message format
 * - Contains placeholders: "Hello {{name}}"
 * - Filled with dynamic data at send time
 * 
 * Why templates in database?
 * - Update messages without deploying code
 * - A/B testing different messages
 * - Multi-language support
 * - Marketing team can manage content
 */

import { pool } from '../config/database';
import { Template, NotificationChannel } from '../types';
import { NotFoundError } from '../middleware/errorHandler';

export class TemplateModel {
  
  /**
   * FIND BY ID - Get template by identifier
   * 
   * Purpose: Load template for rendering
   * 
   * Used by: Worker when sending notification
   * 
   * Example:
   * findById('welcome_email')
   * Returns: Template with subject, body, variables
   */
  static async findById(id: string): Promise<Template> {
    /**
     * Simple SELECT by primary key
     * 
     * Very fast because id is primary key
     * PostgreSQL uses index automatically
     */
    const query = `
      SELECT * FROM templates
      WHERE id = $1
      LIMIT 1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      throw new NotFoundError(`Template with ID ${id} not found`);
    }
    
    return this.parseTemplate(result.rows[0]);
  }
  
  /**
   * FIND BY CHANNEL - Get all templates for a channel
   * 
   * Purpose: List available templates
   * 
   * Example use case:
   * - Admin UI: "Show all email templates"
   * - API documentation: "Available email templates"
   * - Validation: "Is this template valid for SMS?"
   * 
   * Parameters:
   * - channel: 'email', 'sms', or 'push'
   */
  static async findByChannel(channel: NotificationChannel): Promise<Template[]> {
    /**
     * SELECT with WHERE clause
     * 
     * ORDER BY name
     * - Alphabetical order
     * - Consistent ordering for UI
     */
    const query = `
      SELECT * FROM templates
      WHERE channel = $1
      ORDER BY name ASC
    `;
    
    const result = await pool.query(query, [channel]);
    
    return result.rows.map(row => this.parseTemplate(row));
  }
  
  /**
   * FIND ALL - Get all templates
   * 
   * Purpose: Admin dashboard, template management
   * 
   * Note: In production with many templates, add pagination
   * Current implementation loads all templates (fine for < 1000)
   */
  static async findAll(): Promise<Template[]> {
    const query = `
      SELECT * FROM templates
      ORDER BY channel, name ASC
    `;
    
    const result = await pool.query(query);
    
    return result.rows.map(row => this.parseTemplate(row));
  }
  
  /**
   * CREATE - Insert new template
   * 
   * Purpose: Add new notification type
   * 
   * Example:
   * await TemplateModel.create({
   *   id: 'order_confirmed',
   *   name: 'Order Confirmed',
   *   channel: 'email',
   *   subject: 'Your order #{{order_id}} is confirmed!',
   *   body: 'Thank you {{name}}...',
   *   variables: ['name', 'order_id', 'total']
   * });
   * 
   * Used by: Admin API, migration scripts
   */
  static async create(template: Omit<Template, 'created_at' | 'updated_at'>): Promise<Template> {
    /**
     * INSERT template
     * 
     * Omit<Template, 'created_at' | 'updated_at'>
     * - TypeScript utility type
     * - Template without created_at and updated_at
     * - Database generates these automatically
     */
    const query = `
      INSERT INTO templates (
        id,
        name,
        channel,
        subject,
        body,
        variables
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const values = [
      template.id,
      template.name,
      template.channel,
      template.subject || null,        // Email only, null for SMS/Push
      template.body,
      JSON.stringify(template.variables), // Array to JSON
    ];
    
    const result = await pool.query(query, values);
    
    return this.parseTemplate(result.rows[0]);
  }
  
  /**
   * UPDATE - Modify existing template
   * 
   * Purpose: Fix typos, improve messaging, A/B testing
   * 
   * Important: Updating a template affects ALL future notifications
   * - In-flight notifications use old version (already rendered)
   * - New notifications use new version
   * 
   * Consider versioning for critical templates:
   * - welcome_email_v1, welcome_email_v2
   * - Allows gradual rollout
   * - Can compare performance
   */
  static async update(
    id: string,
    updates: Partial<Omit<Template, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<Template> {
    /**
     * Dynamic UPDATE query
     * 
     * Why dynamic?
     * - Only update provided fields
     * - Don't overwrite fields that weren't changed
     * 
     * Example:
     * update('welcome_email', { subject: 'New subject' })
     * Only updates subject, leaves body/variables unchanged
     */
    
    // Build SET clause dynamically
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 2; // Start at $2 (id is $1)
    
    if (updates.name !== undefined) {
      setClauses.push(`name = ${paramIndex}`);
      values.push(updates.name);
      paramIndex++;
    }
    
    if (updates.subject !== undefined) {
      setClauses.push(`subject = ${paramIndex}`);
      values.push(updates.subject);
      paramIndex++;
    }
    
    if (updates.body !== undefined) {
      setClauses.push(`body = ${paramIndex}`);
      values.push(updates.body);
      paramIndex++;
    }
    
    if (updates.variables !== undefined) {
      setClauses.push(`variables = ${paramIndex}`);
      values.push(JSON.stringify(updates.variables));
      paramIndex++;
    }
    
    /**
     * Always update updated_at timestamp
     */
    setClauses.push('updated_at = CURRENT_TIMESTAMP');
    
    /**
     * Check if there are any updates
     */
    if (setClauses.length === 1) { // Only updated_at
      throw new Error('No fields to update');
    }
    
    /**
     * Build final query
     */
    const query = `
      UPDATE templates
      SET ${setClauses.join(', ')}
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await pool.query(query, [id, ...values]);
    
    if (result.rows.length === 0) {
      throw new NotFoundError(`Template with ID ${id} not found`);
    }
    
    return this.parseTemplate(result.rows[0]);
  }
  
  /**
   * DELETE - Remove template
   * 
   * Purpose: Deprecated templates, cleanup
   * 
   * WARNING: Be careful!
   * - Check if template is being used
   * - Notifications reference templates by ID
   * - Deleting breaks historical data
   * 
   * Better approach:
   * - Add 'active' boolean column
   * - Soft delete: SET active = false
   * - Filter queries: WHERE active = true
   */
  static async delete(id: string): Promise<void> {
    const query = `
      DELETE FROM templates
      WHERE id = $1
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rowCount === 0) {
      throw new NotFoundError(`Template with ID ${id} not found`);
    }
  }
  
  /**
   * VALIDATE VARIABLES - Check if data has required variables
   * 
   * Purpose: Ensure notification has all template variables
   * 
   * Example:
   * Template needs: ['name', 'link']
   * Data has: {name: 'John', link: 'https://...'}
   * Result: true
   * 
   * Data has: {name: 'John'} (missing link)
   * Result: false, missingVars: ['link']
   * 
   * Used by: Worker before rendering template
   */
  static validateVariables(
    template: Template,
    data: Record<string, any>
  ): { valid: boolean; missingVars: string[] } {
    /**
     * Check each required variable
     * 
     * filter finds missing variables
     * - varName is required
     * - data[varName] === undefined means it's missing
     */
    const missingVars = template.variables.filter(
      varName => data[varName] === undefined
    );
    
    return {
      valid: missingVars.length === 0,
      missingVars,
    };
  }
  
  /**
   * PARSE TEMPLATE - Convert database row to typed object
   * 
   * Private helper for data transformation
   */
  private static parseTemplate(row: any): Template {
    return {
      id: row.id,
      name: row.name,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      
      /**
       * Parse variables array from JSONB
       * 
       * Database stores: '["name", "link"]'
       * We need: ["name", "link"]
       */
      variables: typeof row.variables === 'string'
        ? JSON.parse(row.variables)
        : row.variables,
      
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
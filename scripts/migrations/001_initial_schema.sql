-- Drop tables if they exist (for development)
DROP TABLE IF EXISTS delivery_logs CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS templates CASCADE;

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'push')),
    template_id VARCHAR(255) NOT NULL,
    data JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'queued', 'processing', 'sent', 'failed', 'retrying')),
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Templates table
CREATE TABLE templates (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    channel VARCHAR(50) NOT NULL,
    subject VARCHAR(500),
    body TEXT NOT NULL,
    variables JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Delivery logs table
CREATE TABLE delivery_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    error_message TEXT,
    provider_response JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
CREATE INDEX idx_notifications_idempotency ON notifications(idempotency_key);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_delivery_logs_notification_id ON delivery_logs(notification_id);

-- Sample templates
INSERT INTO templates (id, name, channel, subject, body, variables) VALUES
('welcome_email', 'Welcome Email', 'email', 'Welcome to {{app_name}}!', 
 'Hello {{name}},

Welcome to our platform! Click here to get started: {{link}}

Best regards,
The Team',
 '["name", "app_name", "link"]'::jsonb),
 
('order_shipped', 'Order Shipped', 'sms', NULL,
 'Hi {{name}}, your order #{{order_id}} has shipped! Track it here: {{tracking_link}}',
 '["name", "order_id", "tracking_link"]'::jsonb),
 
('password_reset', 'Password Reset', 'email', 'Reset Your Password',
 'Hi {{name}},

Click here to reset your password: {{reset_link}}

This link expires in 1 hour.

If you did not request this, please ignore this email.',
 '["name", "reset_link"]'::jsonb);

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✓ Database schema created successfully';
END $$;
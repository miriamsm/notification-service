/**
 * Notification Channels
 * 
 * Purpose: Handle actual delivery of notifications through different channels
 * 
 * Design Pattern: Strategy Pattern
 * - Each channel is a separate strategy
 * - Easy to add new channels (WhatsApp, Slack, etc.)
 * - Interface ensures consistency
 */

import { Template, NotificationChannel } from '../types';
import sgMail from '@sendgrid/mail';
import twilio from 'twilio';

/**
 * Channel Send Result
 * 
 * Standard response from all channels
 */
export interface ChannelSendResult {
  success: boolean;
  messageId?: string;        // Provider's message ID (for tracking)
  error?: string;            // Error message if failed
  providerResponse?: any;    // Raw response from provider (for logging)
}

/**
 * Base Channel Interface
 * 
 * All channels must implement this interface
 * This ensures consistency and makes adding new channels easy
 */
export interface INotificationChannel {
  /**
   * Send notification through this channel
   * 
   * @param recipient - Who to send to (email, phone, device token)
   * @param template - The template to use
   * @param data - Variables to populate template
   * @returns Result with success/failure info
   */
  send(
    recipient: string,
    template: Template,
    data: Record<string, any>
  ): Promise<ChannelSendResult>;
  
  /**
   * Validate recipient format
   * 
   * @param recipient - Email, phone, or token to validate
   * @returns true if valid, false otherwise
   */
  validateRecipient(recipient: string): boolean;
  
  /**
   * Get channel name
   */
  getName(): NotificationChannel;
}

/**
 * Template Rendering Utility
 * 
 * Replace {{variables}} in template with actual values
 */
export function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key]?.toString() || match;
  });
}

/**
 * EMAIL CHANNEL
 * 
 * Sends notifications via email
 * Provider: SendGrid, AWS SES, or Nodemailer
 */
export class EmailChannel implements INotificationChannel {
  
  getName(): NotificationChannel {
    return NotificationChannel.EMAIL;
  }
  
  /**
   * Validate Email Address
   * 
   * Simple regex validation
   * Production: Use a library like validator.js
   */
  validateRecipient(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Send Email
   * For this demo: We'll simulate the send
   */
//   async send(
//     recipient: string,
//     template: Template,
//     data: Record<string, any>
//   ): Promise<ChannelSendResult> {
//     try {
//       // Validate recipient
//       if (!this.validateRecipient(recipient)) {
//         return {
//           success: false,
//           error: `Invalid email address: ${recipient}`,
//         };
//       }
      
//       // Render template
//       const subject = template.subject 
//         ? renderTemplate(template.subject, data)
//         : 'Notification';
//       const body = renderTemplate(template.body, data);
      
//       // Simulate sending email
//       console.log('📧 Sending email...');
//       console.log(`To: ${recipient}`);
//       console.log(`Subject: ${subject}`);
//       console.log(`Body: ${body.substring(0, 100)}...`);
      
//       // Simulate network delay
//       await new Promise(resolve => setTimeout(resolve, 100));
      
//       // Simulate 95% success rate
//       const success = Math.random() > 0.05;
      
//       if (success) {
//         const messageId = `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
//         console.log(`✅ Email sent successfully: ${messageId}`);
        
//         return {
//           success: true,
//           messageId,
//           providerResponse: {
//             provider: 'SendGrid',
//             statusCode: 202,
//             timestamp: new Date().toISOString(),
//           },
//         };
//       } else {
//         throw new Error('SMTP connection timeout');
//       }
      
//     } catch (error) {
//       console.error('❌ Email send failed:', error);
      
//       return {
//         success: false,
//         error: error instanceof Error ? error.message : 'Unknown error',
//         providerResponse: {
//           provider: 'SendGrid',
//           error: error instanceof Error ? error.message : 'Unknown error',
//         },
//       };
//     }
//   }
  
  
//  PRODUCTION IMPLEMENTATION with SendGrid
    
    async send(recipient: string, template: Template, data: Record<string, any>) {
      sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
     
      const msg = {
       to: recipient,
     from: process.env.FROM_EMAIL!,
    subject: renderTemplate(template.subject!, data),
       html: renderTemplate(template.body, data),
      };
      
      try {
        const [response] = await sgMail.send(msg);
        return {
          success: true,
          messageId: response.headers['x-message-id'],
          providerResponse: response,
        };
      } catch (error) {
       return {
          success: false,
      messageId: '',
      providerResponse: error,
        };
      }
   }
   
}

/**
 * SMS CHANNEL
 * 
 * Sends notifications via SMS
 * Provider: Twilio, AWS SNS, or Vonage
 */
export class SMSChannel implements INotificationChannel {
  
  getName(): NotificationChannel {
    return NotificationChannel.SMS;
  }
  
  /**
   * Validate Phone Number
   * 
   * Basic validation - should start with +
   * Production: Use libphonenumber-js for proper validation
   */
  validateRecipient(phone: string): boolean {
    // Basic check: starts with + and has 10-15 digits
    const phoneRegex = /^\+[1-9]\d{9,14}$/;
    return phoneRegex.test(phone);
  }
  
  /**
   * Send SMS
   * 
   * For this demo: We'll simulate the send
   */
//   async send(
//     recipient: string,
//     template: Template,
//     data: Record<string, any>
//   ): Promise<ChannelSendResult> {
//     try {
//       // Validate recipient
//       if (!this.validateRecipient(recipient)) {
//         return {
//           success: false,
//           error: `Invalid phone number: ${recipient}`,
//         };
//       }
      
//       // Render template
//       const message = renderTemplate(template.body, data);
      
//       // Check SMS length (160 chars for single SMS)
//       if (message.length > 160) {
//         console.warn(`⚠️  SMS is ${message.length} chars (will be split into multiple messages)`);
//       }
      
//       // Simulate sending SMS
//       console.log('📱 Sending SMS...');
//       console.log(`To: ${recipient}`);
//       console.log(`Message: ${message}`);
      
//       // Simulate network delay
//       await new Promise(resolve => setTimeout(resolve, 150));
      
//       // Simulate 97% success rate
//       const success = Math.random() > 0.03;
      
//       if (success) {
//         const messageId = `sms_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
//         console.log(`✅ SMS sent successfully: ${messageId}`);
        
//         return {
//           success: true,
//           messageId,
//           providerResponse: {
//             provider: 'Twilio',
//             status: 'sent',
//             numSegments: Math.ceil(message.length / 160),
//             timestamp: new Date().toISOString(),
//           },
//         };
//       } else {
//         throw new Error('Invalid phone number or carrier blocked');
//       }
      
//     } catch (error) {
//       console.error('❌ SMS send failed:', error);
      
//       return {
//         success: false,
//         error: error instanceof Error ? error.message : 'Unknown error',
//         providerResponse: {
//           provider: 'Twilio',
//           error: error instanceof Error ? error.message : 'Unknown error',
//         },
//       };
//     }
//   }
  
  
    // PRODUCTION IMPLEMENTATION with Twilio

   
    private client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!
    );
    
    async send(recipient: string, template: Template, data: Record<string, any>) {
      try {
        const message = await this.client.messages.create({
          body: renderTemplate(template.body, data),
          from: process.env.TWILIO_PHONE_NUMBER!,
          to: recipient,
        });
        
        return {
          success: true,
          messageId: message.sid,
          providerResponse: message,
        };
      } catch (error) {
        return {
          success: false,
         messageId: '',
         providerResponse: error,
        };
      }
    }
   
}

/**
 * PUSH NOTIFICATION CHANNEL
 * 
 * Sends push notifications to mobile devices
 * Provider: Firebase Cloud Messaging (FCM), OneSignal, or AWS SNS
 */
export class PushChannel implements INotificationChannel {
  
  getName(): NotificationChannel {
    return NotificationChannel.PUSH;
  }
  
  /**
   * Validate Device Token
   * 
   * FCM tokens are typically 152+ characters
   * Basic validation: non-empty string with reasonable length
   */
  validateRecipient(token: string): boolean {
    return token.length > 20 && token.length < 300;
  }
  
  /**
   * Send Push Notification
   * 
   * In production, integrate with:
   * - Firebase Cloud Messaging (FCM): Most popular, free
   * - OneSignal: Easier API, multi-platform
   * - AWS SNS: Good if already using AWS
   * 
   * For this demo: We'll simulate the send
   */
  async send(
    recipient: string,
    template: Template,
    data: Record<string, any>
  ): Promise<ChannelSendResult> {
    try {
      // Validate recipient
      if (!this.validateRecipient(recipient)) {
        return {
          success: false,
          error: `Invalid device token: ${recipient.substring(0, 20)}...`,
        };
      }
      
      // Render template
      // For push, we expect template.body to be JSON with title and body
      const body = renderTemplate(template.body, data);
      
      // Parse push notification structure
      let pushData: { title: string; body: string; data?: any };
      try {
        pushData = JSON.parse(body);
      } catch {
        // If not JSON, use as simple body with default title
        pushData = {
          title: 'Notification',
          body: body,
        };
      }
      
      // Simulate sending push
      console.log('🔔 Sending push notification...');
      console.log(`To device: ${recipient.substring(0, 30)}...`);
      console.log(`Title: ${pushData.title}`);
      console.log(`Body: ${pushData.body}`);
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 120));
      
      // Simulate 90% success rate (push has more failures - invalid tokens, etc.)
      const success = Math.random() > 0.10;
      
      if (success) {
        const messageId = `push_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`✅ Push notification sent successfully: ${messageId}`);
        
        return {
          success: true,
          messageId,
          providerResponse: {
            provider: 'FCM',
            multicastId: Math.floor(Math.random() * 1000000),
            success: 1,
            failure: 0,
            timestamp: new Date().toISOString(),
          },
        };
      } else {
        throw new Error('Invalid device token or app not installed');
      }
      
    } catch (error) {
      console.error('❌ Push notification failed:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        providerResponse: {
          provider: 'FCM',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
  
  /**
   * PRODUCTION IMPLEMENTATION with Firebase
   * 
   * Uncomment and use this in production:
   * 
   * import * as admin from 'firebase-admin';
   * 
   * private messaging = admin.messaging();
   * 
   * async send(recipient: string, template: Template, data: Record<string, any>) {
   *   const body = renderTemplate(template.body, data);
   *   const pushData = JSON.parse(body);
   *   
   *   const message = {
   *     token: recipient,
   *     notification: {
   *       title: pushData.title,
   *       body: pushData.body,
   *     },
   *     data: pushData.data || {},
   *   };
   *   
   *   try {
   *     const messageId = await this.messaging.send(message);
   *     return {
   *       success: true,
   *       messageId,
   *       providerResponse: { messageId },
   *     };
   *   } catch (error) {
   *     return {
   *       success: false,
   *       error: error.message,
   *       providerResponse: error,
   *     };
   *   }
   * }
   */
}

/**
 * Channel Factory
 * 
 * Returns the appropriate channel implementation
 * 
 * Why a factory?
 * - Centralized channel creation
 * - Easy to add new channels
 * - Type-safe channel selection
 */
export class ChannelFactory {
  private static channels = new Map<NotificationChannel, INotificationChannel>([
    [NotificationChannel.EMAIL, new EmailChannel()],
    [NotificationChannel.SMS, new SMSChannel()],
    [NotificationChannel.PUSH, new PushChannel()],
  ]);
  
  /**
   * Get channel instance by type
   * 
   * @param channel - Channel type (email, sms, push)
   * @returns Channel implementation
   * @throws Error if channel not supported
   */
  static getChannel(channel: NotificationChannel): INotificationChannel {
    const channelInstance = this.channels.get(channel);
    
    if (!channelInstance) {
      throw new Error(`Unsupported channel: ${channel}`);
    }
    
    return channelInstance;
  }
  
  /**
   * Add new channel
   * 
   * Use this to add WhatsApp, Slack, etc.
   * 
   * Example:
   * ChannelFactory.addChannel(NotificationChannel.WHATSAPP, new WhatsAppChannel());
   */
  static addChannel(channel: NotificationChannel, implementation: INotificationChannel): void {
    this.channels.set(channel, implementation);
    console.log(`✓ Registered channel: ${channel}`);
  }
  
  /**
   * Get all supported channels
   */
  static getSupportedChannels(): NotificationChannel[] {
    return Array.from(this.channels.keys());
  }
}

/**
 * ADDING NEW CHANNELS
 * 
 * To add WhatsApp, Slack, or any new channel:
 * 
 * 1. Add to enum in types.ts:
 *    export enum NotificationChannel {
 *      WHATSAPP = 'whatsapp',
 *      SLACK = 'slack',
 *    }
 * 
 * 2. Create channel class:
 *    export class WhatsAppChannel implements INotificationChannel {
 *      getName() { return NotificationChannel.WHATSAPP; }
 *      validateRecipient(phone: string) { ... }
 *      async send(recipient, template, data) { ... }
 *    }
 * 
 * 3. Register in factory:
 *    ChannelFactory.addChannel(
 *      NotificationChannel.WHATSAPP,
 *      new WhatsAppChannel()
 *    );
 * 
 * That's it! No changes needed to service, worker, or API.
 */
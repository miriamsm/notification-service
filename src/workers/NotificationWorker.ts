import { Worker, Job } from 'bullmq';
import { queueRedis } from '../config/redis';
import { NotificationModel } from '../models/Notification';
import { TemplateModel } from '../models/Template';
import { DeliveryLogModel } from '../models/DeliveryLog';
import {ChannelFactory }from '../channels/NotificationChannels';
import {
  NotificationJobData,
  NotificationStatus,
  Notification,
  Template,
} from '../types';

/**
 * Process Notification Job
 */
async function processNotification(
  job: Job<NotificationJobData>
): Promise<{ success: boolean; messageId?: string }> {
  
  const { notificationId } = job.data;
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing notification: ${notificationId}`);
  console.log(`Job ID: ${job.id}`);
  console.log(`Attempt: ${job.attemptsMade + 1}/${job.opts.attempts || 1}`);
  console.log(`${'='.repeat(60)}\n`);
  
  try {
    const notification = await NotificationModel.findById(notificationId);
    
    console.log(`Found notification for user: ${notification.user_id}`);
    console.log(`Channel: ${notification.channel}`);
    console.log(`Template: ${notification.template_id}`);
    console.log(`Status: ${notification.status}`);
    
    if (notification.status === NotificationStatus.SENT) {
      console.log('⚠️  Notification already sent, skipping');
      return { success: true };
    }
    
    await NotificationModel.updateStatus(notificationId,
      NotificationStatus.PROCESSING,
    );
    
    const template = await TemplateModel.findById(notification.template_id);
    
    console.log(`Template: ${template.name}`);
    console.log(`Variables: ${template.variables.join(', ')}`);
    
    const recipient = getRecipientForUser(notification.user_id, notification.channel);
    
    console.log(`Recipient: ${recipient}`);
    
    const channel = ChannelFactory.getChannel(notification.channel);
    
    console.log(`Sending via ${channel.getName()}...`);
    
    const result = await channel.send(recipient, template, notification.data);
    
    if (result.success) {
      await NotificationModel.updateStatus(notificationId,
         NotificationStatus.SENT);
      
      console.log(`✅ Notification sent successfully`);
      console.log(`Message ID: ${result.messageId}`);
      
    } else {
      const isLastAttempt = (job.attemptsMade + 1) >= (job.opts.attempts || 1);
      
      await NotificationModel.updateStatus(notificationId, 
        isLastAttempt ? NotificationStatus.FAILED : NotificationStatus.RETRYING,
        );
      
      if (isLastAttempt) {
        console.log(`❌ Notification failed permanently after ${job.attemptsMade + 1} attempts`);
      } else {
        console.log(`⚠️  Notification failed, will retry (attempt ${job.attemptsMade + 1})`);
      }
      
      console.log(`Error: ${result.error}`);
    }
    
    await DeliveryLogModel.create(
    notificationId,
       job.attemptsMade + 1,
     result.success ? NotificationStatus.SENT : NotificationStatus.FAILED,
     result.error,
     result.providerResponse,
    );
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Completed processing: ${notificationId}`);
    console.log(`Result: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`${'='.repeat(60)}\n`);
    
    if (result.success) {
      return { success: true, messageId: result.messageId };
    } else {
      throw new Error(result.error || 'Failed to send notification');
    }
    
  } catch (error) {
    console.error(`\n❌ Error processing notification ${notificationId}:`, error);
    
    try {
      await DeliveryLogModel.create(
        notificationId,
        job.attemptsMade + 1,
        NotificationStatus.FAILED,
         error instanceof Error ? error.message : 'Unknown error',
        { error: String(error) },
      );
    } catch (logError) {
      console.error('Failed to create delivery log:', logError);
    }
    
    throw error;
  }
}

function getRecipientForUser(userId: string, channel: string): string {
  const mockRecipients = {
    email: `user${userId}@example.com`,
    sms: `+1555${userId.padStart(7, '0')}`,
    push: `fcm_token_${userId}_${Math.random().toString(36).substr(2, 30)}`,
  };
  
  return mockRecipients[channel as keyof typeof mockRecipients] || mockRecipients.email;
}

const worker = new Worker<NotificationJobData>(
  'notifications',
  processNotification,
  {
    connection: queueRedis,
    concurrency: 10,
    removeOnComplete: { count: 1000, age: 3600 },
    removeOnFail: { age: 86400 },
    limiter: {
      max: 500,
      duration: 60000,
    },
  }
);

worker.on('ready', () => {
  console.log('🚀 Worker started and ready to process jobs');
});

worker.on('active', (job: Job<NotificationJobData>) => {
  console.log(`\n▶️  Started processing job ${job.id}`);
});

worker.on('completed', (job: Job<NotificationJobData>, result: any) => {
  console.log(`✅ Job ${job.id} completed successfully`);
  if (result.messageId) {
    console.log(`   Message ID: ${result.messageId}`);
  }
});

worker.on('failed', (job: Job<NotificationJobData> | undefined, error: Error) => {
  if (job) {
    console.error(`❌ Job ${job.id} failed:`, error.message);
    console.error(`   Attempts made: ${job.attemptsMade}/${job.opts.attempts || 1}`);
    
    const isLastAttempt = job.attemptsMade >= (job.opts.attempts || 1);
    if (isLastAttempt) {
      console.error(`   ⛔ Job moved to failed queue (no more retries)`);
    } else {
      console.error(`   🔄 Job will be retried`);
    }
  } else {
    console.error('❌ Job failed with no job info:', error);
  }
});

worker.on('error', (error: Error) => {
  console.error('🔥 Worker error:', error);
});

worker.on('stalled', (jobId: string) => {
  console.warn(`⚠️  Job ${jobId} stalled (taking too long or worker died)`);
});

async function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  try {
    await worker.close();
    console.log('✓ Worker closed');
    
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    await queueRedis.quit();
    console.log('✓ Redis connection closed');
    
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export { worker };
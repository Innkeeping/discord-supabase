import { Client, GatewayIntentBits, Message, TextChannel, Events, ThreadChannel } from 'discord.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path-browserify';

dotenv.config();

interface ChannelData {
  channel_id: string;
  channel_name: string;
}

interface ThreadData {
  thread_id: string;
  channel_id: string;  // This will be converted to UUID when inserting
  title: string;
  created_at: string;
  is_active: boolean;
}

interface MessageData {
  channel_id: string;  // This will be converted to UUID when inserting
  thread_id?: string;  // This will be converted to UUID when inserting
  message_id: string;
  reply_to?: string;
  author_id: string;
  content: string;
  created_at: string;
  urls: string[];
  media_urls: string[];
  embed_urls: string[];
  reactions: { [emoji: string]: number };
}

interface ReactionData {
  message_id: string;
  emoji: string;
  count: number;
  updated_at: string;
}

class DiscordBot {
  private client: Client;
  private supabase: SupabaseClient;
  private targetChannelIds: Set<string>;
  private applicationId: string;
  private mediaDir: string;
  private urlsDir: string;

  constructor() {
    const requiredEnvVars = [
      'DISCORD_APPLICATION_ID',
      'DISCORD_BOT_TOKEN',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_KEY',
      'TARGET_CHANNEL_IDS'
    ];
    
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing required environment variable: ${envVar}`);
      }
    }

    this.applicationId = process.env.DISCORD_APPLICATION_ID!;
    this.targetChannelIds = new Set(process.env.TARGET_CHANNEL_IDS!.split(','));
    this.mediaDir = path.resolve('assets/media');
    this.urlsDir = path.resolve('assets/urls');

    // Ensure directories exist
    fs.ensureDirSync(this.mediaDir);
    fs.ensureDirSync(this.urlsDir);

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions
      ],
    });

    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    this.setupEventHandlers();
  }

  private extractUrls(content: string): string[] {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return content.match(urlRegex) || [];
  }

  private async ensureChannelExists(channelData: ChannelData): Promise<string> {
    const { data, error } = await this.supabase
      .from('channels')
      .select('id')
      .eq('channel_id', channelData.channel_id)
      .single();

    if (error || !data) {
      const { data: newChannel, error: insertError } = await this.supabase
        .from('channels')
        .insert(channelData)
        .select('id')
        .single();

      if (insertError) throw insertError;
      return newChannel.id;
    }

    return data.id;
  }

  private async ensureThreadExists(threadData: ThreadData): Promise<string> {
    const { data, error } = await this.supabase
      .from('threads')
      .select('id')
      .eq('thread_id', threadData.thread_id)
      .single();

    if (error || !data) {
      const { data: newThread, error: insertError } = await this.supabase
        .from('threads')
        .insert(threadData)
        .select('id')
        .single();

      if (insertError) throw insertError;
      return newThread.id;
    }

    return data.id;
  }

  private async downloadMedia(url: string, channelName: string, messageId: string, createdAt: Date): Promise<void> {
    try {
      // Determine if this is a Discord CDN URL
      const isDiscordCdn = url.startsWith('https://cdn.discordapp.com/');
      
      // Create channel directory if it doesn't exist
      const channelDir = path.join(
        (url.startsWith('http') && !isDiscordCdn) ? this.urlsDir : this.mediaDir,
        channelName.replace(/[<>:"/\\|?*]/g, '_')
      );
      await fs.ensureDir(channelDir);

      // For Discord CDN URLs, extract the original file extension
      let ext: string;
      if (isDiscordCdn) {
        const urlObj = new URL(url);
        ext = path.extname(urlObj.pathname.split('?')[0]) || '.txt';
      } else {
        ext = (url.startsWith('http') && !isDiscordCdn) ? '.md' : path.extname(url) || '.txt';
      }

      const filename = `${messageId}_${channelName}_${createdAt.toISOString().replace(/[:.]/g, '-')}${ext}`;
      const filepath = path.join(channelDir, filename);

      if (url.startsWith('http')) {
        if (isDiscordCdn) {
          // Download Discord CDN files directly
          const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream'
          });

          const writer = fs.createWriteStream(filepath);
          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
        } else {
          // For other URLs, create a markdown file with metadata
          const markdownContent = `# URL Reference
- **Original URL**: ${url}
- **Message ID**: ${messageId}
- **Channel**: ${channelName}
- **Timestamp**: ${createdAt.toISOString()}
- **Downloaded**: ${new Date().toISOString()}

## Quick Access
[Open Original URL](${url})
`;
          await fs.writeFile(filepath, markdownContent);
        }
      } else {
        // For direct media attachments, download the file
        const response = await axios({
          method: 'GET',
          url: url,
          responseType: 'stream'
        });

        const writer = fs.createWriteStream(filepath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });
      }

      console.log(`${(url.startsWith('http') && !isDiscordCdn) ? 'Created reference for' : 'Downloaded media from'} ${url} to ${filepath}`);
    } catch (error) {
      console.error(`Error processing media from ${url}:`, error);
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    if (message.author.bot || !this.targetChannelIds.has(message.channelId)) return;

    // Handle /mostreacted command
    if (message.content === '/mostreacted') {
      try {
        const { data: messages, error } = await this.supabase
          .from('messages')
          .select(`
            message_id,
            channels!inner(channel_name, channel_id),
            content,
            created_at,
            reactions,
            media_urls,
            urls,
            embed_urls
          `)
          .eq('channels.channel_name', '💻│developers')
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
          .neq('reactions', '{}')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching most reacted messages:', error);
          await message.reply('Sorry, there was an error fetching the most reacted messages.');
          return;
        }

        if (!messages || messages.length === 0) {
          await message.reply('No reacted messages found in the developers channel for the last 24 hours.');
          return;
        }

        // Sort by total reactions and take top 3
        const sortedMessages = messages
          .map(msg => ({
            ...msg,
            totalReactions: Object.values(msg.reactions).reduce((sum: number, count: any) => sum + Number(count), 0)
          }))
          .sort((a, b) => b.totalReactions - a.totalReactions)
          .slice(0, 3);

        // Format response
        const channelLink = `https://discord.com/channels/${message.guild?.id}/994775534733115412`;
        let response = `**Most Popular Messages in [#developers](${channelLink}) (Last 24h)**\n\n`;
        
        for (const msg of sortedMessages) {
          // Start message block
          response += `│ 🔗 **Message Link:**\n`;
          response += `│ https://discord.com/channels/${message.guild?.id}/${msg.channels.channel_id}/${msg.message_id}\n`;
          
          // Format message content
          response += `│ 💬 **Message Contents:**\n`;
          if (msg.content.trim()) {
            response += `│ ${msg.content.replace(/\n/g, '\n│ ')}\n`;
          } else {
            response += `│ *message has no contents*\n`;
          }
          
          // Format reactions (simplified)
          const totalReactions = Object.values(msg.reactions).reduce((sum: number, count: any) => sum + Number(count), 0);
          response += `│ ⭐ **Reactions:** ${totalReactions}\n`;
          
          // Add media URLs if any exist
          const allUrls = [
            ...(msg.media_urls || []),
            ...(msg.urls || []),
            ...(msg.embed_urls || [])
          ].filter(url => !msg.content.includes(url)); // Only show URLs not already in content
          
          if (allUrls.length > 0) {
            response += `│ 📎 **Media:**\n`;
            response += `│ ${allUrls.join('\n│ ')}\n`;
          }
          
          // Add separator between messages
          response += '\n';
        }

        await message.reply(response);
      } catch (error) {
        console.error('Error handling /mostreacted command:', error);
        await message.reply('Sorry, there was an error processing your request.');
      }
      return;
    }

    try {
      // Ensure channel exists and get its UUID
      const channelUuid = await this.ensureChannelExists({
        channel_id: message.channel.id,
        channel_name: (message.channel as TextChannel).name,
      });

      // Handle thread if message is in one
      let threadUuid: string | undefined;
      if (message.channel instanceof ThreadChannel) {
        threadUuid = await this.ensureThreadExists({
          thread_id: message.channel.id,
          channel_id: channelUuid,
          title: message.channel.name,
          created_at: message.channel.createdAt!.toISOString(),
          is_active: !message.channel.archived
        });
      } else if (message.hasThread) {
        // If this message started a thread, store the thread
        const thread = message.thread!;
        threadUuid = await this.ensureThreadExists({
          thread_id: thread.id,
          channel_id: channelUuid,
          title: thread.name,
          created_at: thread.createdAt!.toISOString(),
          is_active: !thread.archived
        });
      }

      const urls = this.extractUrls(message.content);
      const mediaUrls = Array.from(message.attachments.values()).map(a => a.url);
      const embedUrls = message.embeds.map(e => e.url).filter((url): url is string => url !== null);

      const messageData: MessageData = {
        channel_id: channelUuid,
        thread_id: threadUuid,
        message_id: message.id,
        reply_to: message.reference?.messageId,
        author_id: message.author.id,
        content: message.content,
        created_at: message.createdAt.toISOString(),
        urls,
        media_urls: mediaUrls,
        embed_urls: embedUrls,
        reactions: {}
      };

      // Download media and URLs
      const channelName = (message.channel as TextChannel).name;
      const downloadPromises = [
        ...mediaUrls.map(url => this.downloadMedia(url, channelName, message.id, message.createdAt)),
        ...urls.map(url => this.downloadMedia(url, channelName, message.id, message.createdAt)),
        ...embedUrls.map(url => this.downloadMedia(url, channelName, message.id, message.createdAt))
      ];

      await Promise.all(downloadPromises);

      const { error } = await this.supabase
        .from('messages')
        .upsert(messageData, {
          onConflict: 'message_id',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Error upserting message:', error);
        throw error;
      }
      
      console.log(`Stored message ${message.id} from channel ${channelName}${message.reference?.messageId ? ' (reply to ' + message.reference.messageId + ')' : ''}`);
    } catch (error) {
      console.error('Error storing message:', error);
    }
  }

  private async handleReaction(reaction: any, user: any, added: boolean) {
    try {
      const message = reaction.message;
      if (!this.targetChannelIds.has(message.channel.id)) {
        console.log(`Skipping reaction in non-target channel: ${message.channel.id}`);
        return;
      }

      // Get current reaction count
      const reactionCount = reaction.count;
      const emoji = reaction.emoji.toString();
      console.log(`Processing ${added ? 'added' : 'removed'} reaction ${emoji} (count: ${reactionCount}) on message ${message.id}`);

      // Update reactions in messages table
      const { data: messageData, error: messageError } = await this.supabase
        .from('messages')
        .select('reactions')
        .eq('message_id', message.id)
        .single();

      if (messageError) {
        console.error('Error fetching message reactions:', messageError);
        return;
      }

      const reactions = messageData?.reactions || {};
      console.log('Current reactions:', reactions);
      
      if (added) {
        reactions[emoji] = reactionCount;
      } else {
        if (reactionCount === 0) {
          delete reactions[emoji];
        } else {
          reactions[emoji] = reactionCount;
        }
      }
      
      console.log('Updated reactions:', reactions);

      // Update message with new reactions
      const { error: updateError } = await this.supabase
        .from('messages')
        .update({ reactions })
        .eq('message_id', message.id);

      if (updateError) {
        console.error('Error updating message reactions:', updateError);
      } else {
        console.log(`Successfully updated reactions for message ${message.id}`);
      }
    } catch (error) {
      console.error('Error handling reaction:', error);
    }
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, () => {
      console.log(`Logged in as ${this.client.user?.tag} (ID: ${this.applicationId})`);
      console.log(`Monitoring channels: ${Array.from(this.targetChannelIds).join(', ')}`);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      await this.handleMessage(message);
    });

    // Handle thread creation
    this.client.on(Events.ThreadCreate, async (thread) => {
      if (!thread.parentId || !this.targetChannelIds.has(thread.parentId)) return;
      
      try {
        const channelUuid = await this.ensureChannelExists({
          channel_id: thread.parentId,
          channel_name: (thread.parent as TextChannel)?.name || 'unknown',
        });

        await this.ensureThreadExists({
          thread_id: thread.id,
          channel_id: channelUuid,
          title: thread.name,
          created_at: thread.createdAt!.toISOString(),
          is_active: !thread.archived
        });

        console.log(`Stored new thread ${thread.name}`);
      } catch (error) {
        console.error('Error storing thread:', error);
      }
    });

    this.client.on(Events.MessageReactionAdd, (reaction, user) => {
      this.handleReaction(reaction, user, true);
    });

    this.client.on(Events.MessageReactionRemove, (reaction, user) => {
      this.handleReaction(reaction, user, false);
    });

    this.client.on(Events.Error, (error) => {
      console.error('Discord client error:', error);
    });
  }

  public async start(): Promise<void> {
    try {
      await this.client.login(process.env.DISCORD_BOT_TOKEN);
    } catch (error) {
      console.error('Failed to start bot:', error);
      process.exit(1);
    }
  }
}

const bot = new DiscordBot();
bot.start();
# Nexus - Hyperfy Agent Bot

A Discord bot that anonymously captures messages from specified channels for RAG pipeline integration.

## Features

- Anonymous message capture from designated channels
- Secure storage in Supabase
- TypeScript implementation
- Built with discord.js

## Setup

1. Clone repository:

```bash
git clone [your-repo-url]
cd [your-repo-name]
```

2. Install dependencies:

```bash
npm install
```

3. Create `.env` file:

```env
DISCORD_APPLICATION_ID=your_app_id
DISCORD_TOKEN=your_bot_token
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
TARGET_CHANNEL_ID=your_channel_id
```

4. Setup Supabase table:

```sql
create table messages (
  id uuid default uuid_generate_v4() primary key,
  content text not null,
  created_at timestamptz default now(),
  attachments jsonb,
  embeds jsonb,
  channel_name text
);
```

5. Build and run:

```bash
npm run build
npm start
```

## Add to Server

Use this link to add the bot to your server:

```
https://discord.com/oauth2/authorize?client_id=1333097981603479553&permissions=274877975552&integration_type=0&scope=bot
```

Required permissions:

- Read Messages/View Channels
- Read Message History
- Send Messages

## Development

```bash
npm run dev
```

## License

MIT

## Security

- Data is stored anonymously
- Only captures messages from specified channels
- Provides user data deletion upon request
- Secure credential management through environment variables

-- Drop existing tables in reverse order of dependencies
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS threads;
DROP TABLE IF EXISTS channels;

-- 1. Create channels table
CREATE TABLE channels (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  channel_id text NOT NULL UNIQUE,
  channel_name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 2. Create threads table
CREATE TABLE threads (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  channel_id uuid REFERENCES channels(id),
  thread_id text NOT NULL UNIQUE,
  title text,
  created_at timestamptz NOT NULL,
  is_active boolean DEFAULT true
);

-- 3. Create messages table with reactions and replies
CREATE TABLE messages (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  channel_id uuid REFERENCES channels(id),
  thread_id uuid REFERENCES threads(id),
  message_id text NOT NULL UNIQUE,
  reply_to text,  -- Discord message ID of the message being replied to
  author_id text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL,
  urls text[],
  media_urls text[],
  embed_urls text[],
  reactions jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT valid_reactions CHECK (jsonb_typeof(reactions) = 'object')
);

-- Find messages with the most reactions from the last 24 hours
WITH reaction_counts AS (
    SELECT 
        m.id,
        m.message_id,
        c.channel_name,
        t.title as thread_title,
        m.author_id,
        m.content,
        m.created_at,
        m.reactions,
        -- Sum all reaction counts from the reactions object
        (SELECT SUM(CAST(value AS INTEGER))
         FROM jsonb_each_text(m.reactions)) as total_reactions,
        -- Get all reactions as a formatted string
        STRING_AGG(key || ': ' || value, ', ') as reaction_list
    FROM 
        messages m
        LEFT JOIN channels c ON m.channel_id = c.id
        LEFT JOIN threads t ON m.thread_id = t.id,
        jsonb_each_text(m.reactions) as r(key, value)
    WHERE 
        m.reactions != '{}'::jsonb
        AND m.created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY 
        m.id, m.message_id, c.channel_name, t.title, 
        m.author_id, m.content, m.created_at, m.reactions
)
SELECT 
    channel_name,
    message_id,
    thread_title,
    author_id,
    content,
    created_at,
    total_reactions,
    reaction_list,
    reactions as raw_reactions
FROM 
    reaction_counts
ORDER BY 
    channel_name,
    total_reactions DESC,
    created_at DESC;

-- Find all messages containing code blocks
SELECT 
    m.message_id,
    c.channel_name,
    t.title as thread_title,
    m.author_id,
    m.content,
    m.created_at,
    m.urls,
    m.media_urls,
    m.embed_urls
FROM 
    messages m
    LEFT JOIN channels c ON m.channel_id = c.id
    LEFT JOIN threads t ON m.thread_id = t.id
WHERE 
    m.content LIKE '%```%'
ORDER BY 
    m.created_at DESC;

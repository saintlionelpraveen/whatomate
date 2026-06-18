DO $$ 
DECLARE
    explore_id uuid;
BEGIN
    SELECT id INTO explore_id FROM keyword_rules WHERE name = 'Explore Tools Menu' LIMIT 1;

    IF explore_id IS NOT NULL THEN
        -- Overwrite the rows array entirely to remove any duplicates
        UPDATE keyword_rules 
        SET response_content = jsonb_set(
            response_content, 
            '{sections,0,rows}', 
            '[
                {"id": "tool_ghost", "title": "👻 Ghost", "description": "Modern publishing platform for newsletters & blogs"},
                {"id": "tool_fms", "title": "📊 FMS", "description": "Frappe Management System for business operations"},
                {"id": "tool_mattermost", "title": "💬 Mattermost", "description": "Secure team messaging & collaboration"},
                {"id": "tool_listmonk", "title": "📧 Listmonk", "description": "Self-hosted newsletter & mailing list manager"},
                {"id": "tool_whatomate", "title": "🤖 WhatoMate", "description": "WhatsApp CRM & chatbot automation"},
                {"id": "tool_wordpress", "title": "🌐 WordPress", "description": "Open-source Content Management System"},
                {"id": "tool_upcoming", "title": "🚀 Upcoming Tools", "description": "See what we are building next"}
            ]'::jsonb
        )
        WHERE id = explore_id;
    END IF;
END $$;

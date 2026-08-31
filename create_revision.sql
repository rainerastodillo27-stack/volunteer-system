-- SQL Script to Create a REVISED Proposal Card
-- Run this in Supabase SQL Editor

-- Step 1: Find the rejected proposal and create a revised message card
DO $$
DECLARE
    v_app_id TEXT;
    v_project_id TEXT;
    v_partner_id TEXT;
    v_partner_name TEXT;
    v_proposal_details JSONB;
    v_admin_id TEXT;
    v_msg_id TEXT;
    v_timestamp TEXT;
    v_revised_app JSONB;
BEGIN
    -- Get the rejected proposal
    SELECT 
        partner_project_applications_id,
        project_id,
        partner_user_id,
        partner_name,
        proposal_details::jsonb
    INTO 
        v_app_id,
        v_project_id,
        v_partner_id,
        v_partner_name,
        v_proposal_details
    FROM public.partner_project_applications
    WHERE status = 'Rejected'
    ORDER BY requested_at DESC
    LIMIT 1;

    -- Check if we found a rejected proposal
    IF v_app_id IS NULL THEN
        RAISE EXCEPTION '❌ No rejected proposal found!';
    END IF;

    RAISE NOTICE '📋 Found rejected proposal: %', v_app_id;
    RAISE NOTICE '   Partner: %', v_partner_name;

    -- Get admin user ID
    SELECT users_id INTO v_admin_id
    FROM public.users
    WHERE role = 'admin'
    LIMIT 1;

    RAISE NOTICE '   Admin: %', v_admin_id;

    -- Generate message ID and timestamp
    v_msg_id := 'msg-proposal-' || EXTRACT(EPOCH FROM NOW())::BIGINT * 1000;
    v_timestamp := TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

    -- Update proposal details with revision note
    v_proposal_details := jsonb_set(
        v_proposal_details,
        '{proposedDescription}',
        to_jsonb(COALESCE(v_proposal_details->>'proposedDescription', '') || 
                 E'\n\n✏️ [REVISED] Updated based on admin feedback.')
    );

    -- Create the revised application JSON
    v_revised_app := jsonb_build_object(
        'id', v_app_id,
        'applicationId', v_app_id,
        'projectId', v_project_id,
        'partnerUserId', v_partner_id,
        'partnerName', v_partner_name,
        'status', 'Pending',
        'requestedAt', v_timestamp,
        'resubmittedAt', v_timestamp,
        'revisionNumber', 1,
        'proposalDetails', v_proposal_details
    );

    -- Insert the message card
    INSERT INTO public.messages (
        messages_id,
        sender_id,
        recipient_id,
        project_id,
        content,
        timestamp,
        read,
        attachments
    ) VALUES (
        v_msg_id,
        v_partner_id,
        v_admin_id,
        NULL,
        '___PROPOSAL_CARD___:' || v_revised_app::text,
        v_timestamp,
        false,
        '[]'
    );

    RAISE NOTICE '✅ Created revised message card: %', v_msg_id;
    RAISE NOTICE '';
    RAISE NOTICE '🎉 SUCCESS! Refresh Communication Hub to see:';
    RAISE NOTICE '   - OLD: REJECTED card (should show "OLDER VERSION" warning)';
    RAISE NOTICE '   - NEW: SUBMITTED - Revised Proposal #1';

END $$;

-- Verify the message was created
SELECT 
    messages_id,
    sender_id,
    LEFT(content, 80) as content_preview,
    timestamp
FROM public.messages
WHERE content LIKE '___PROPOSAL_CARD___%'
ORDER BY timestamp DESC
LIMIT 3;

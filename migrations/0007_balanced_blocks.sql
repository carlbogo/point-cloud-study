-- Update unused invitations only. Started runs retain their sampled sequence.
UPDATE invitations SET plan_id='study-2222-v4',answer_mode='hybrid'
WHERE plan_id IN ('study-3211-v2','study-2211-v3')
AND NOT EXISTS(SELECT 1 FROM runs WHERE runs.invitation_id=invitations.id);

-- Preserve existing runs and historical modes. Unused full-study invitations use the new plan.
UPDATE invitations SET plan_id='study-2211-v3',answer_mode='hybrid'
WHERE plan_id='study-3211-v2' AND NOT EXISTS(SELECT 1 FROM runs WHERE runs.invitation_id=invitations.id);

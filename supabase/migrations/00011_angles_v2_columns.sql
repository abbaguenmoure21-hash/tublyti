-- P35: Add formula and frustration_resolved columns to angles table
-- These track which title formula was used and which frustration each angle addresses

alter table angles add column if not exists formula text;
alter table angles add column if not exists frustration_resolved text;

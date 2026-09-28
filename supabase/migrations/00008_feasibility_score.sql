-- P33: Feasibility Score
-- Add grade (A-F) and explanation to topic_scores

alter table topic_scores
  add column if not exists feasibility_grade text,    -- 'A', 'B', 'C', 'D', 'E', 'F'
  add column if not exists feasibility_reason text;   -- human-readable explanation (French)

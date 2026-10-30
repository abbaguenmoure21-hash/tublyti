import { Lightbulb, Clapperboard, Upload, BarChart3, type LucideIcon } from 'lucide-react';
import type { PipelineColumn } from '../page';

/** Board steps. Neutral icons: phase colors are reserved to topic phases (DESIGN.md). */
export const COLUMNS: { id: PipelineColumn; label: string; icon: LucideIcon }[] = [
  { id: 'idea', label: 'Idée', icon: Lightbulb },
  { id: 'in_production', label: 'En production', icon: Clapperboard },
  { id: 'published', label: 'Publiée', icon: Upload },
  { id: 'measured', label: 'Mesurée', icon: BarChart3 },
];

export const COLUMN_LABEL: Record<PipelineColumn, string> = {
  idea: 'Idée',
  in_production: 'En production',
  published: 'Publiée',
  measured: 'Mesurée',
};

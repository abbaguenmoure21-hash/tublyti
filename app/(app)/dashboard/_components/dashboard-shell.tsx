'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MatriceView } from './matrice-view';
import { TopicPreview } from './topic-preview';

interface TopicRow {
  id: string;
  label: string;
  mgi: number;
  demand: number;
  frustration: number;
  supplyQ: number;
  monetization: number;
  phase: number;
  feasibilityGrade: string | null;
  feasibilityReason: string | null;
  sparkline: number[];
  topQuote: string | null;
  rank: number;
  totalInNiche: number;
}

export function DashboardShell({ 
  topics, 
  children 
}: { 
  topics: TopicRow[]; 
  children?: React.ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSelect = useCallback((id: string | null) => {
    setSelectedId(id);
  }, []);

  const previewTopics = topics.map((t, i) => ({
    ...t,
    rank: i + 1,
    totalInNiche: topics.length,
  }));

  return (
    <div className="flex items-start w-full">
      {/* Contenu principal */}
      <div className="flex-1 min-w-0 flex flex-col gap-10">
        <MatriceView topics={topics} selectedId={selectedId} onSelect={handleSelect} />
        {children}
      </div>

      {/* Panneau latéral STICKY — pousse le contenu au lieu de se superposer */}
      <AnimatePresence>
        {selectedId && (
          <motion.div
            className="hidden lg:block sticky top-[72px] z-30 shrink-0"
            initial={{ opacity: 0, width: 0, marginLeft: 0 }}
            animate={{ opacity: 1, width: 320, marginLeft: 32 }}
            exit={{ opacity: 0, width: 0, marginLeft: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            style={{ maxHeight: 'calc(100vh - 96px)' }}
          >
            <div className="w-[320px] h-full overflow-y-auto hide-scrollbar">
              <TopicPreview topics={previewTopics} selectedId={selectedId} onSelect={handleSelect} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

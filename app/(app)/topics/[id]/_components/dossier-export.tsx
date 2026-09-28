'use client';

import { useState } from 'react';
import { FileText, Copy, Download, Printer, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';

export function DossierExport({ topicId }: { topicId: string }) {
  const [loading, setLoading] = useState(false);

  async function fetchMarkdown(): Promise<string | null> {
    setLoading(true);
    try {
      const res = await fetch(`/api/topics/${topicId}/dossier`);
      if (!res.ok) throw new Error('Erreur lors de la génération du dossier.');
      const data = await res.json();
      return data.markdown as string;
    } catch {
      toast.error('Impossible de générer le dossier.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    const md = await fetchMarkdown();
    if (!md) return;
    await navigator.clipboard.writeText(md);
    toast.success('Dossier copié dans le presse-papiers.');
  }

  function handleDownload() {
    window.open(`/api/topics/${topicId}/dossier?format=md`, '_blank');
  }

  function handlePrint() {
    window.open(`/topics/${topicId}/print`, '_blank');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
        Exporter
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleCopy}>
          <Copy className="w-4 h-4 mr-2" />
          Copier en Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleDownload}>
          <Download className="w-4 h-4 mr-2" />
          Télécharger .md
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handlePrint}>
          <Printer className="w-4 h-4 mr-2" />
          Imprimer / PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Shield, Settings, Database, Activity } from 'lucide-react';
import Link from 'next/link';

export const metadata = { title: 'Espace Admin' };

export default function AdminPage() {
  return (
    <div className="flex-1 flex flex-col min-h-full">
      <header className="h-[64px] shrink-0 flex items-center px-8 border-b border-[--glass-border] bg-[--bg-surface-1]/50 backdrop-blur-xl">
        <h1 className="text-[20px] font-semibold text-foreground tracking-tight">Espace Admin</h1>
      </header>

      <div className="flex-1 p-6 md:p-12 max-w-4xl mx-auto w-full space-y-8 fade-in">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-[24px] font-bold text-foreground">Administration</h2>
            <p className="text-muted-foreground text-[14px]">Supervision et gestion système de TubLyTI</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link 
            href="/admin/jobs" 
            className="group bg-card rounded-2xl border border-[--glass-border] p-6 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col items-start gap-4"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">Jobs & Tâches de fond</h3>
              <p className="text-sm text-muted-foreground mt-1">Superviser l'exécution des tâches périodiques, l'aspiration des vidéos et l'actualisation des données.</p>
            </div>
          </Link>

          <Link 
            href="/settings" 
            className="group bg-card rounded-2xl border border-[--glass-border] p-6 hover:border-primary/50 hover:shadow-md transition-all cursor-pointer flex flex-col items-start gap-4"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <Settings className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">Réglages Globaux</h3>
              <p className="text-sm text-muted-foreground mt-1">Gérer les quotas API, les paramètres de scoring, les niches et l'apparence.</p>
            </div>
          </Link>

          {/* Placeholder for future admin tools */}
          <div className="bg-card rounded-2xl border border-[--glass-border] p-6 opacity-50 flex flex-col items-start gap-4">
            <div className="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Gestion de la Base de Données</h3>
              <p className="text-sm text-muted-foreground mt-1">Accès direct aux tables, nettoyage des logs et maintenance. (Bientôt disponible)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

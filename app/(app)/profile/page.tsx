import { createClient } from '@/lib/supabase/server';
import { User, Mail, Shield, Key } from 'lucide-react';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Mon Profil' };

export default async function ProfilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="flex-1 flex flex-col min-h-full">
      <header className="h-[64px] shrink-0 flex items-center px-8 border-b border-[--glass-border] bg-[--bg-surface-1]/50 backdrop-blur-xl">
        <h1 className="text-[20px] font-semibold text-foreground tracking-tight">Mon profil</h1>
      </header>

      <div className="flex-1 p-6 md:p-12 max-w-4xl mx-auto w-full space-y-8 fade-in">
        
        {/* User Card */}
        <div className="bg-card rounded-2xl border border-[--glass-border] p-6 shadow-sm flex items-center gap-6">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/20 to-blue-600/20 text-primary flex items-center justify-center text-3xl font-bold border border-primary/20">
            {user.email?.charAt(0).toUpperCase() || 'U'}
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-[24px] font-bold text-foreground">Utilisateur</h2>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-4 h-4" />
              <span>{user.email}</span>
            </div>
          </div>
          <div className="px-3 py-1 bg-primary/10 text-primary text-[12px] font-bold rounded-full uppercase tracking-wider">
            Membre
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card rounded-2xl border border-[--glass-border] p-5 space-y-4">
            <div className="flex items-center gap-3 text-foreground font-semibold pb-3 border-b border-border/50">
              <Key className="w-5 h-5 text-muted-foreground" />
              Informations du compte
            </div>
            <div className="space-y-3 text-[14px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">ID Utilisateur</span>
                <span className="font-mono text-xs">{user.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Dernière connexion</span>
                <span>{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString('fr-FR') : 'N/A'}</span>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-[--glass-border] p-5 space-y-4">
            <div className="flex items-center gap-3 text-foreground font-semibold pb-3 border-b border-border/50">
              <Shield className="w-5 h-5 text-muted-foreground" />
              Sécurité & Accès
            </div>
            <div className="space-y-3 text-[14px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Rôle</span>
                <span>{user.role === 'authenticated' ? 'Authentifié' : user.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fournisseur</span>
                <span className="capitalize">{user.app_metadata.provider || 'Email'}</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

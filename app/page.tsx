"use client";

import Link from 'next/link';
import { ArrowRight, BarChart3, BrainCircuit, Activity, LayoutGrid, CheckCircle2, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';

const fadeUpVariant = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } }
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15
    }
  }
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background selection:bg-primary/20 selection:text-primary overflow-x-hidden">
      {/* Background gradients */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.5, scale: 1 }}
          transition={{ duration: 2, ease: "easeOut" }}
          className="absolute -top-[20%] -left-[10%] w-[70%] h-[70%] rounded-full bg-primary/10 blur-[120px] mix-blend-normal dark:opacity-20" 
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 0.5, scale: 1 }}
          transition={{ duration: 2, ease: "easeOut", delay: 0.5 }}
          className="absolute top-[40%] -right-[10%] w-[50%] h-[50%] rounded-full bg-blue-500/10 blur-[120px] mix-blend-normal dark:opacity-20" 
        />
      </div>

      {/* Navigation */}
      <motion.nav 
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 md:px-12 md:py-5 border-b border-black/5 dark:border-white/5 bg-white/60 dark:bg-black/60 backdrop-blur-2xl"
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-blue-600 shadow-sm flex items-center justify-center">
            <BarChart3 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">TubLyTI</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-[14px] font-medium text-muted-foreground">
          <a href="#features" className="hover:text-foreground transition-colors">Fonctionnalités</a>
          <a href="#how-it-works" className="hover:text-foreground transition-colors">Fonctionnement</a>
          <a href="#pricing" className="hover:text-foreground transition-colors">Tarifs</a>
          <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
        </div>
        <Link 
          href="/dashboard"
          className="haptic-btn text-[14px] font-semibold bg-black dark:bg-white text-white dark:text-black px-5 py-2 rounded-full shadow-sm hover:shadow-md transition-all"
        >
          Accéder à l'app
        </Link>
      </motion.nav>

      <main className="flex flex-col items-center justify-center pt-32 pb-24 text-center">
        {/* 1. HERO SECTION */}
        <motion.section 
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="relative w-full max-w-6xl px-6 flex flex-col items-center pt-10 pb-20"
        >
          <motion.div variants={fadeUpVariant}>
            <Badge variant="outline" className="rounded-full px-4 py-1.5 mb-8 border-primary/30 bg-primary/5 text-primary text-[13px] font-semibold backdrop-blur-md">
              TubLyTI 2.0 est maintenant disponible
            </Badge>
          </motion.div>
          
          <motion.h1 variants={fadeUpVariant} className="text-5xl md:text-7xl lg:text-[80px] font-extrabold tracking-tighter text-foreground max-w-5xl leading-[1.05]">
            Trouvez les <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">failles</span> du marché YouTube.
          </motion.h1>
          
          <motion.p variants={fadeUpVariant} className="mt-8 text-[18px] md:text-[22px] text-muted-foreground max-w-3xl leading-relaxed font-medium">
            L'outil d'analyse stratégique qui transforme les frustrations des spectateurs et le vide de l'offre en vidéos à très haut potentiel.
          </motion.p>

          <motion.div variants={fadeUpVariant} className="flex flex-col sm:flex-row items-center gap-4 mt-12">
            <Link 
              href="/dashboard"
              className="haptic-btn group flex items-center gap-2 bg-gradient-to-b from-primary to-blue-600 text-white px-8 py-4 rounded-full text-[16px] font-bold shadow-[0_4px_14px_rgba(10,132,255,0.39)] hover:shadow-[0_6px_20px_rgba(10,132,255,0.23)] hover:scale-[1.02] transition-all"
            >
              Démarrer l'analyse
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              href="#features"
              className="haptic-btn px-8 py-4 rounded-full text-[16px] font-bold bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 hover:bg-black/10 dark:hover:bg-white/10 transition-all text-foreground"
            >
              Découvrir la plateforme
            </Link>
          </motion.div>

          {/* Hero Image Mockup Placeholder */}
          <motion.div 
            variants={fadeUpVariant}
            className="mt-20 w-full max-w-5xl aspect-[16/9] rounded-[32px] md:rounded-[40px] bg-gradient-to-b from-white/40 to-white/10 dark:from-white/10 dark:to-white/5 backdrop-blur-3xl border border-black/5 dark:border-white/10 shadow-2xl overflow-hidden relative flex items-center justify-center p-4"
          >
            <div className="absolute top-0 left-0 right-0 h-12 bg-black/5 dark:bg-white/5 border-b border-black/5 dark:border-white/10 flex items-center px-6 gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <div className="w-full h-full mt-10 rounded-[20px] border border-black/5 dark:border-white/10 shadow-inner relative overflow-hidden">
               <img src="/real_dashboard.png" alt="TubLyTI Dashboard Screenshot" className="w-full h-full object-cover object-top" />
               <div className="absolute inset-0 bg-gradient-to-br from-transparent via-white/10 dark:via-white/5 to-transparent pointer-events-none" />
            </div>
          </motion.div>
        </motion.section>

        {/* 2. SOCIAL PROOF */}
        <motion.section 
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-50px" }}
          variants={fadeUpVariant}
          className="w-full py-12 border-y border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]"
        >
          <p className="text-[14px] font-bold uppercase tracking-widest text-muted-foreground mb-8 text-center">
            Analysant quotidiennement les données de
          </p>
          <div className="flex flex-wrap justify-center gap-12 md:gap-24 opacity-50 grayscale">
            {/* Logos Placeholders */}
            <div className="text-xl font-black tracking-tighter">Youtube API</div>
            <div className="text-xl font-black tracking-tighter">Google Trends</div>
            <div className="text-xl font-black tracking-tighter">Reddit Data</div>
            <div className="text-xl font-black tracking-tighter">OpenAI</div>
          </div>
        </motion.section>

        {/* 3. FEATURES (Bento Grid) */}
        <section id="features" className="w-full max-w-6xl px-6 py-32 flex flex-col items-center">
          <motion.h2 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6"
          >
            Tout ce qu'il vous faut pour dominer votre niche.
          </motion.h2>
          <motion.p 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            className="text-xl text-muted-foreground max-w-2xl text-center mb-16"
          >
            Arrêtez de deviner. Prenez des décisions basées sur des millions de points de données croisés en temps réel.
          </motion.p>

          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="w-full grid grid-cols-1 md:grid-cols-3 gap-6 text-left"
          >
            <motion.div variants={fadeUpVariant} className="md:col-span-2 group relative overflow-hidden rounded-[32px] bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/10 p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-all">
              <div className="w-14 h-14 rounded-2xl bg-blue-500/10 flex items-center justify-center mb-6">
                <Activity className="w-7 h-7 text-blue-500" />
              </div>
              <h3 className="text-2xl font-bold text-foreground tracking-tight mb-3">Market Gap Index (MGI)</h3>
              <p className="text-muted-foreground text-[16px] leading-relaxed max-w-lg">
                Score exclusif mesurant l'intensité de la demande non satisfaite. Repérez instantanément ce que le public cherche désespérément mais ne trouve pas sur la plateforme.
              </p>
            </motion.div>

            <motion.div variants={fadeUpVariant} className="group relative overflow-hidden rounded-[32px] bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/10 p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-all">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/10 flex items-center justify-center mb-6">
                <BrainCircuit className="w-7 h-7 text-rose-500" />
              </div>
              <h3 className="text-2xl font-bold text-foreground tracking-tight mb-3">IA Sémiotique</h3>
              <p className="text-muted-foreground text-[16px] leading-relaxed">
                Analyse NLP des milliers de commentaires YouTube pour classifier les frustrations.
              </p>
            </motion.div>

            <motion.div variants={fadeUpVariant} className="md:col-span-3 group relative overflow-hidden rounded-[32px] bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/10 p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-all flex flex-col md:flex-row items-center gap-10">
              <div className="flex-1">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-6">
                  <LayoutGrid className="w-7 h-7 text-emerald-500" />
                </div>
                <h3 className="text-2xl font-bold text-foreground tracking-tight mb-3">Matrice d'Opportunités (Océans Bleus)</h3>
                <p className="text-muted-foreground text-[16px] leading-relaxed">
                  Visualisez instantanément votre marché. Notre graphique croise la demande des spectateurs et l'offre existante pour révéler les Océans Bleus : les sujets massivement demandés mais totalement ignorés par vos concurrents.
                </p>
              </div>
              <div className="flex-1 w-full h-[240px] rounded-2xl border border-black/5 dark:border-white/10 overflow-hidden relative shadow-inner">
                 <img src="/real_matrix.png" alt="TubLyTI Matrix Screenshot" className="w-full h-full object-cover object-left-top" />
                 <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/10 to-transparent pointer-events-none" />
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* 4. HOW IT WORKS */}
        <section id="how-it-works" className="w-full py-32 bg-black/[0.02] dark:bg-white/[0.02] border-y border-black/5 dark:border-white/5 overflow-hidden">
          <div className="max-w-6xl mx-auto px-6 flex flex-col items-center">
            <motion.h2 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={fadeUpVariant}
              className="text-4xl md:text-5xl font-extrabold tracking-tight mb-16"
            >
              Comment ça marche ?
            </motion.h2>
            
            <motion.div 
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-100px" }}
              variants={staggerContainer}
              className="grid grid-cols-1 md:grid-cols-3 gap-12 text-center"
            >
              <motion.div variants={fadeUpVariant} className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-white dark:bg-white/10 border border-black/10 dark:border-white/20 flex items-center justify-center text-xl font-bold mb-6 shadow-sm">1</div>
                <h3 className="text-xl font-bold mb-3">Collecte Data</h3>
                <p className="text-muted-foreground leading-relaxed">Le moteur aspire chaque nuit des milliers de vidéos et de commentaires issus de votre niche YouTube.</p>
              </motion.div>
              <motion.div variants={fadeUpVariant} className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-white dark:bg-white/10 border border-black/10 dark:border-white/20 flex items-center justify-center text-xl font-bold mb-6 shadow-sm">2</div>
                <h3 className="text-xl font-bold mb-3">Analyse IA</h3>
                <p className="text-muted-foreground leading-relaxed">Notre IA classe les commentaires pour extraire les frustrations et évalue la demande grâce au score MGI.</p>
              </motion.div>
              <motion.div variants={fadeUpVariant} className="flex flex-col items-center">
                <div className="w-16 h-16 rounded-full bg-white dark:bg-white/10 border border-black/10 dark:border-white/20 flex items-center justify-center text-xl font-bold mb-6 shadow-sm">3</div>
                <h3 className="text-xl font-bold mb-3">Décision & Action</h3>
                <p className="text-muted-foreground leading-relaxed">Vous identifiez le trou de marché exact et glissez l'idée directement dans votre Pipeline de production.</p>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* 5. PRICING */}
        <section id="pricing" className="w-full max-w-6xl px-6 py-32 flex flex-col items-center">
          <motion.h2 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            className="text-4xl md:text-5xl font-extrabold tracking-tight mb-6"
          >
            Des tarifs simples et transparents.
          </motion.h2>
          <motion.p 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            className="text-xl text-muted-foreground max-w-2xl text-center mb-16"
          >
            Investissez dans des données qui garantissent des milliers de vues supplémentaires à chaque vidéo.
          </motion.p>

          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl text-left"
          >
            {/* Starter Plan */}
            <motion.div variants={fadeUpVariant} className="rounded-[32px] bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-black/5 dark:border-white/10 p-10 flex flex-col relative overflow-hidden">
              <h3 className="text-2xl font-bold mb-2">Créateur</h3>
              <p className="text-muted-foreground mb-6">Pour lancer votre chaîne sur des bases solides.</p>
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-5xl font-black tracking-tighter">49€</span>
                <span className="text-muted-foreground">/mois</span>
              </div>
              <ul className="space-y-4 mb-10 flex-1">
                {['Suivi de 10 chaînes concurrentes', 'Calcul du score MGI basique', 'Analyse NLP standard', 'Pipeline Kanban avec 50 cartes'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-[15px] font-medium text-foreground/80">
                    <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button type="button" className="w-full haptic-btn bg-black/5 dark:bg-white/10 text-foreground py-4 rounded-full font-bold transition-colors hover:bg-black/10 dark:hover:bg-white/20">
                Commencer gratuitement
              </button>
            </motion.div>

            {/* Pro Plan */}
            <motion.div variants={fadeUpVariant} className="rounded-[32px] bg-white dark:bg-[#12141a] border-2 border-primary/20 p-10 flex flex-col relative overflow-hidden shadow-[0_20px_60px_rgba(10,132,255,0.15)] transform md:-translate-y-4">
              <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-primary to-blue-500" />
              <Badge className="absolute top-6 right-6 bg-primary/10 text-primary hover:bg-primary/20 border-primary/20">Populaire</Badge>
              
              <h3 className="text-2xl font-bold mb-2">Pro</h3>
              <p className="text-muted-foreground mb-6">Pour les créateurs et agences qui scalent.</p>
              <div className="flex items-baseline gap-1 mb-8">
                <span className="text-5xl font-black tracking-tighter">99€</span>
                <span className="text-muted-foreground">/mois</span>
              </div>
              <ul className="space-y-4 mb-10 flex-1">
                {['Suivi illimité de chaînes', 'Score MGI + Google Trends temps réel', 'Analyse de frustrations avancée (Deep NLP)', 'Pipeline Kanban illimité', 'Accès API & Exports CSV'].map((feature, i) => (
                  <li key={i} className="flex items-center gap-3 text-[15px] font-medium text-foreground/80">
                    <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <button type="button" className="w-full haptic-btn bg-gradient-to-b from-primary to-blue-600 text-white shadow-lg py-4 rounded-full font-bold transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-primary/30">
                Choisir le plan Pro
              </button>
            </motion.div>
          </motion.div>
        </section>

        {/* 6. FAQ */}
        <section id="faq" className="w-full max-w-3xl px-6 py-24 flex flex-col items-center text-left">
          <motion.h2 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={fadeUpVariant}
            className="text-3xl md:text-4xl font-extrabold tracking-tight mb-12 text-center"
          >
            Questions fréquentes
          </motion.h2>
          
          <motion.div 
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-100px" }}
            variants={staggerContainer}
            className="w-full space-y-4"
          >
            <motion.details variants={fadeUpVariant} className="group bg-white/60 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 rounded-[24px] overflow-hidden [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex items-center justify-between p-6 text-lg font-bold cursor-pointer outline-none">
                Combien de temps faut-il pour avoir des données exploitables ?
                <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-6 pb-6 text-muted-foreground text-[15px] leading-relaxed">
                Pour les chaînes très actives (beaucoup de vues et commentaires), les données sont fiables dès la première collecte (Jour 1). Pour les petites niches, l'algorithme a besoin de 3 à 7 jours pour lisser les statistiques et certifier une opportunité.
              </div>
            </motion.details>

            <motion.details variants={fadeUpVariant} className="group bg-white/60 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 rounded-[24px] overflow-hidden [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex items-center justify-between p-6 text-lg font-bold cursor-pointer outline-none">
                Est-ce compatible avec toutes les thématiques YouTube ?
                <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-6 pb-6 text-muted-foreground text-[15px] leading-relaxed">
                Oui. Que vous soyez dans le divertissement, l'éducation, le B2B ou le gaming, TubLyTI s'adapte en scannant les concurrents directs que vous lui indiquez lors du paramétrage initial.
              </div>
            </motion.details>

            <motion.details variants={fadeUpVariant} className="group bg-white/60 dark:bg-white/5 backdrop-blur-md border border-black/5 dark:border-white/10 rounded-[24px] overflow-hidden [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex items-center justify-between p-6 text-lg font-bold cursor-pointer outline-none">
                Le score MGI est-il vraiment prédictif ?
                <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-6 pb-6 text-muted-foreground text-[15px] leading-relaxed">
                Le Market Gap Index (MGI) est un modèle mathématique exclusif. Il croise la demande globale avec le taux de frustration dans les commentaires, tout en pénalisant l'offre existante. Si le MGI est "Très fort", c'est qu'il existe une réelle carence de marché pour cette vidéo.
              </div>
            </motion.details>
          </motion.div>
        </section>
      </main>

      {/* 7. FOOTER */}
      <footer className="w-full border-t border-black/5 dark:border-white/10 bg-black/5 dark:bg-white/5 py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-80">
            <div className="w-6 h-6 rounded-lg bg-foreground shadow-sm flex items-center justify-center">
              <BarChart3 className="w-3 h-3 text-background" />
            </div>
            <span className="font-bold tracking-tight">TubLyTI</span>
          </div>
          
          <div className="flex gap-8 text-[14px] font-medium text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">Mentions légales</a>
            <a href="#" className="hover:text-foreground transition-colors">Politique de confidentialité</a>
            <a href="#" className="hover:text-foreground transition-colors">Contact</a>
          </div>

          <div className="text-[13px] text-muted-foreground/60 font-medium">
            © {new Date().getFullYear()} TubLyTI. Tous droits réservés.
          </div>
        </div>
      </footer>
    </div>
  );
}

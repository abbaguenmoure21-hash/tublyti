import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'TubLyTI',
    description: 'Detecte les opportunites YouTube directement depuis ton navigateur.',
    version: '0.1.0',
    permissions: ['sidePanel', 'storage', 'tabs'],
    host_permissions: [
      'https://www.youtube.com/*',
      `${process.env.TUBLYTI_URL ?? 'https://tublyti.vercel.app'}/*`,
    ],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    action: {
      default_title: 'TubLyTI',
    },
    commands: {
      '_execute_action': {
        suggested_key: {
          default: 'Alt+T',
        },
        description: 'Ouvrir le panneau TubLyTI',
      },
    },
  },
});

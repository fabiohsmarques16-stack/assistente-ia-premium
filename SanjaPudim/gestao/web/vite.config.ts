import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Teste local sem Supabase: API_LOCAL=http://localhost:3000 aponta /rest/v1 para um PostgREST local
const apiLocal = process.env.API_LOCAL;

export default defineConfig({
  server: apiLocal ? { proxy: { '/rest/v1': { target: apiLocal, rewrite: (p) => p.replace(/^\/rest\/v1/, '') } } } : undefined,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icone.svg'],
      manifest: {
        name: 'SANJA Gestão',
        short_name: 'SANJA',
        description: 'Gestão da Sanja Pudim: pedidos, estoque, receitas, compras e relatórios.',
        lang: 'pt-BR',
        theme_color: '#8a4a10',
        background_color: '#fff8ec',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icone-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // dados comerciais nunca ficam em cache: sempre vêm do Supabase
        navigateFallback: '/index.html',
        runtimeCaching: [],
      },
    }),
  ],
});

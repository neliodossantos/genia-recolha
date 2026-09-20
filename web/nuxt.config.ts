export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@nuxt/ui', 'nitro-cloudflare-dev'],
  css: ['~/assets/css/main.css'],
  nitro: { preset: 'cloudflare-pages' },
  runtimeConfig: {
    public: {
      supabaseUrl: '',
      supabaseAnonKey: '',
      emailDomain: 'lga.local',
    },
  },
})

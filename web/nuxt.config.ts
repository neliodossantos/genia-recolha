export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  ssr: false,
  devtools: { enabled: false },
  modules: ['@nuxt/ui', 'nitro-cloudflare-dev'],
  css: ['~/assets/css/main.css'],
  // No fixed Nitro preset: Vercel is detected automatically. For Cloudflare Pages
  // build with NITRO_PRESET=cloudflare-pages.
  runtimeConfig: {
    // Server-only (never sent to the browser). Set via NUXT_R2_* environment variables.
    r2AccountId: '',
    r2AccessKeyId: '',
    r2SecretAccessKey: '',
    r2Bucket: '',
    public: {
      supabaseUrl: '',
      supabaseAnonKey: '',
      emailDomain: 'lga.local',
    },
  },
})

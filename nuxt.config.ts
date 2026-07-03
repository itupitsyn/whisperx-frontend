// https://nuxt.com/docs/api/configuration/nuxt-config
const backend = process.env.WHISPERX_API_URL || 'http://localhost:8000'

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  nitro: {
    routeRules: {
      '/api/**': { proxy: `${backend}/api/**` }
    }
  }
})

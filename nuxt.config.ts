// https://nuxt.com/docs/api/configuration/nuxt-config
const backend = process.env.WHISPERX_API_URL || 'http://localhost:8000'

export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  devtools: { enabled: true },

  app: {
    head: {
      title: 'WhisperX — транскрипция и разметка речи',
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [{ name: 'theme-color', content: '#0e0f13' }]
    }
  },

  nitro: {
    routeRules: {
      '/api/**': { proxy: `${backend}/api/**` }
    }
  }
})

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import km from './km.json'
import { useSettings } from '@/store/settings'

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, km: { translation: km } },
  lng: useSettings.getState().lang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

useSettings.subscribe((s, prev) => {
  if (s.lang !== prev.lang) i18n.changeLanguage(s.lang)
})

export default i18n

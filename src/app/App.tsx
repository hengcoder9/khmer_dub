import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { gatewayPayload, useSettings } from '@/store/settings'
import { useProject, undo, redo, saveNow } from '@/store/project'
import { useUi } from '@/store/ui'
import { connectEvents } from '@/store/jobs'
import { post } from '@/lib/api'
import { isTyping } from '@/lib/utils'
import { Layout } from '@/components/Layout'
import { Home } from '@/features/project/Home'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { ExportDialog } from '@/features/export/ExportDialog'
import { AutomateDialog } from '@/features/automate/AutomateDialog'
import { NewProjectDialog } from '@/features/project/NewProjectDialog'
import { UpdateModal } from '@/features/update/UpdateModal'
import { LinkDialog, SourceDialog } from '@/features/project/ImportTools'
import { WatermarkDialog } from '@/features/project/WatermarkDialog'
import { ReadScreenDialog } from '@/features/project/ReadScreenDialog'
import { SubCoverDialog } from '@/features/project/SubCoverDialog'
import { AdsDialog } from '@/features/project/AdsDialog'
import { EffectsDialog } from '@/features/project/EffectsDialog'
import { OverlaysDialog } from '@/features/project/OverlaysDialog'
import { JobDock } from '@/components/JobDock'
import { GatewayDialog } from '@/features/gateway/GatewayDialog'
import { AccountDialog } from '@/features/account/AccountDialog'
import { startAccountSync, useAccount } from '@/store/account'

function useApplyTheme() {
  const theme = useSettings((s) => s.theme)
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  const accent = useSettings((s) => s.accent)
  const uiScale = useSettings((s) => s.uiScale)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
  useEffect(() => {
    document.documentElement.dataset.accent = accent
  }, [accent])
  useEffect(() => {
    window.api.setZoom?.(uiScale)
  }, [uiScale])
  return dark
}

export function App() {
  const dark = useApplyTheme()
  const lang = useSettings((s) => s.lang)
  const hasProject = useProject((s) => !!s.project)
  const settings = useUi((s) => s.settings)
  const dialog = useUi((s) => s.dialog)
  const setUi = useUi((s) => s.set)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // a Home tool (AI Video, shorts…) asked for a new project: open that tool as soon as the project is there
  useEffect(() => {
    if (!hasProject) return
    const intent = useUi.getState().intent
    if (!intent) return
    setUi({ intent: null })
    if (intent === 'link') return void setTimeout(() => setUi({ dialog: 'link' }), 150)
    setUi({ centerTab: 'editor' })
    setTimeout(() => document.getElementById(intent)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
  }, [hasProject, setUi])

  // backend events + engine config on start
  useEffect(() => {
    connectEvents().catch(() => {})
    startAccountSync()
    // first launch while signed out: show sign-in / free trial once
    const unsub = useAccount.subscribe((a) => {
      if (!a.loaded) return
      unsub()
      if (!a.signedIn) setUi({ dialog: 'account' })
    })
    const s = useSettings.getState()
    post('/engines/config', {
      gpuLanes: s.gpuLanes,
      cloneLanes: s.cloneLanes,
      clone: { engine: s.cloneEngine, model: s.cloneModel, ckptFile: s.cloneCkpt || undefined, vocabFile: s.cloneVocab || undefined }
    }).catch(() => {})
    post('/llm/config', { codecraftBaseUrl: s.codecraftBaseUrl, claudeWorkspaceId: s.claudeWorkspaceId }).catch(() => {})
    post('/gateway/mode', { mode: s.routeMode }).catch(() => {})
    if (s.gatewayEnabled) post('/gateway/config', gatewayPayload()).catch(() => {})
    const flush = () => void saveNow()
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (isTyping(e.target) && k !== 's') return
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault()
        redo()
      } else if (k === 's') {
        e.preventDefault()
        saveNow()
      } else if (k === ',') {
        e.preventDefault()
        setUi({ settings: 'general' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setUi])

  return (
    <>
      {hasProject ? <Layout /> : <Home />}
      <SettingsModal section={settings} onSectionChange={(s) => setUi({ settings: s })} />
      {dialog === 'export' && <ExportDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'automate' && <AutomateDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'newProject' && <NewProjectDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'link' && <LinkDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'source' && <SourceDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'readscreen' && <ReadScreenDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'subcover' && <SubCoverDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'ads' && <AdsDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'effects' && <EffectsDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'overlays' && <OverlaysDialog initialTab={useUi.getState().overlayTab} onClose={() => setUi({ dialog: null })} />}
      {dialog === 'gateway' && <GatewayDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'account' && <AccountDialog onClose={() => setUi({ dialog: null })} />}
      <UpdateModal />
      {hasProject && <JobDock />}
      <Toaster theme={dark ? 'dark' : 'light'} position="top-right" offset={64} richColors closeButton />
    </>
  )
}

import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { useSettings } from '@/store/settings'
import { useProject, undo, redo, saveNow } from '@/store/project'
import { useUi } from '@/store/ui'
import { connectEvents } from '@/store/jobs'
import { post } from '@/lib/api'
import { isTyping } from '@/lib/utils'
import { Layout } from '@/components/Layout'
import { Welcome } from '@/features/project/Welcome'
import { SettingsModal } from '@/features/settings/SettingsModal'
import { ExportDialog } from '@/features/export/ExportDialog'
import { AutomateDialog } from '@/features/automate/AutomateDialog'
import { NewProjectDialog } from '@/features/project/NewProjectDialog'
import { UpdateModal } from '@/features/update/UpdateModal'
import { LinkDialog, SourceDialog } from '@/features/project/ImportTools'
import { WatermarkDialog } from '@/features/project/WatermarkDialog'

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
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
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

  // backend events + engine config on start
  useEffect(() => {
    connectEvents().catch(() => {})
    const s = useSettings.getState()
    post('/engines/config', {
      gpuLanes: s.gpuLanes,
      cloneLanes: s.cloneLanes,
      clone: { model: s.cloneModel, ckptFile: s.cloneCkpt || undefined, vocabFile: s.cloneVocab || undefined }
    }).catch(() => {})
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
      {hasProject ? <Layout /> : <Welcome />}
      <SettingsModal section={settings} onSectionChange={(s) => setUi({ settings: s })} />
      {dialog === 'export' && <ExportDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'automate' && <AutomateDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'newProject' && <NewProjectDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'link' && <LinkDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'source' && <SourceDialog onClose={() => setUi({ dialog: null })} />}
      {dialog === 'watermark' && <WatermarkDialog onClose={() => setUi({ dialog: null })} />}
      <UpdateModal />
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" richColors closeButton />
    </>
  )
}

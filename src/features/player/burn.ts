import { toast } from 'sonner'
import i18n from 'i18next'
import { mutate, useProject } from '@/store/project'
import { useSettings } from '@/store/settings'

/**
 * Turn burned-in captions on/off. The preview follows: captions show on the video when they will be
 * burned in, and hide when they won't (the player's CC button can still show them as a preview only).
 */
export function setBurnSubtitles(on: boolean, notify = true) {
  if (!useProject.getState().project) return
  mutate((p) => ({ ...p, settings: { ...p.settings, burnSubtitles: on } }), { undo: false })
  useSettings.getState().set({ showSubtitles: on })
  if (notify)
    toast.info(
      on
        ? i18n.t('tools.burnOn2', 'Burn ON — the subtitles you see in the preview will be burned into the video when you Export (style: AI Video Editor → Captions)')
        : i18n.t('tools.burnOff2', 'Burn OFF — captions are hidden on the video and will not be burned in')
    )
}

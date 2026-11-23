// Keeps API keys in step with the account server:
//   • shared keys (added by the admin) are pulled into memory while the account has active access
//   • the user's own keys are backed up to their account and restored on a new PC
// Keys travel only main ↔ server over the account connection; the renderer sees masks.

import { accountCall, isSignedIn } from './account'
import { addFromServer, localKeys, setServerId, setSharedKeys } from './keystore'
import type { KeyEntry } from '../shared/types'

interface Remote {
  id: number
  provider: KeyEntry['provider']
  label: string
  key: string
}

/** Returns true when anything changed (so the backend pool should be refreshed). */
export async function syncKeys(): Promise<boolean> {
  if (!isSignedIn()) {
    setSharedKeys([])
    return true
  }
  try {
    const r = (await accountCall('keys', undefined, true)) as { shared: Remote[]; mine: Remote[] }
    setSharedKeys(r.shared)
    for (const k of r.mine) addFromServer(k.provider, k.key, k.label, k.id)
    // keys typed on this PC that the server doesn't have yet
    for (const k of localKeys().filter((x) => x.sid === undefined)) {
      const res = (await accountCall('keys/add', { provider: k.provider, key: k.key, label: k.label ?? '' }, true)) as { id: number }
      setServerId(k.id, res.id)
    }
    return true
  } catch (e) {
    if ((e as { signedOut?: boolean }).signedOut) setSharedKeys([])
    return !!(e as { signedOut?: boolean }).signedOut
  }
}

/** Remove the saved copy of a key from the server (best effort). */
export async function forgetKey(sid: number | undefined): Promise<void> {
  if (sid === undefined || !isSignedIn()) return
  await accountCall('keys/remove', { id: sid }, true).catch(() => {})
}

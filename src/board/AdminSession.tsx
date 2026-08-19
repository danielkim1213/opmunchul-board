import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

interface UserFlags {
  isAdmin: boolean
  isBanned: boolean
}

interface AdminSessionValue {
  viewerUsername: string
  viewerIsAdmin: boolean
  flags: Record<string, UserFlags>
  patchFlags: (username: string, next: UserFlags) => void
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null)

export function AdminSessionProvider({
  viewerUsername,
  viewerIsAdmin,
  children,
}: {
  viewerUsername: string
  viewerIsAdmin: boolean
  children: ReactNode
}) {
  const [flags, setFlags] = useState<Record<string, UserFlags>>({})
  const patchFlags = useCallback((username: string, next: UserFlags) => {
    setFlags((prev) => ({ ...prev, [username]: next }))
  }, [])
  const value = useMemo(
    () => ({ viewerUsername, viewerIsAdmin, flags, patchFlags }),
    [viewerUsername, viewerIsAdmin, flags, patchFlags],
  )
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>
}

export function useAdminSession() {
  return useContext(AdminSessionContext)
}

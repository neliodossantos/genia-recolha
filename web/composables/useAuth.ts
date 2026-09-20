import type { Session } from '@supabase/supabase-js'
import { isValidUsername, toAuthEmail, toUsernameSlug } from '~/utils/username'

function friendlyError(message: string): string {
  if (/already registered/i.test(message)) return 'Este nome já existe. Escolhe outro ou entra.'
  if (/invalid login credentials/i.test(message)) return 'Nome ou palavra-passe incorretos.'
  if (/password should be at least/i.test(message)) return 'A palavra-passe tem de ter pelo menos 6 caracteres.'
  return message
}

export function useAuth() {
  const { $supabase } = useNuxtApp()
  const config = useRuntimeConfig()
  const session = useState<Session | null>('auth-session', () => null)
  const ready = useState<boolean>('auth-ready', () => false)

  async function init() {
    if (ready.value) return
    const { data } = await $supabase.auth.getSession()
    session.value = data.session
    $supabase.auth.onAuthStateChange((_event, next) => {
      session.value = next
    })
    ready.value = true
  }

  function credentials(username: string) {
    const slug = toUsernameSlug(username)
    if (!isValidUsername(slug)) {
      throw new Error('O nome tem de ter entre 3 e 32 letras ou números.')
    }
    return toAuthEmail(username, config.public.emailDomain as string)
  }

  async function signUp(username: string, password: string) {
    const email = credentials(username)
    const { error } = await $supabase.auth.signUp({ email, password })
    if (error) throw new Error(friendlyError(error.message))
  }

  async function signIn(username: string, password: string) {
    const email = credentials(username)
    const { error } = await $supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(friendlyError(error.message))
  }

  async function signOut() {
    await $supabase.auth.signOut()
  }

  return { session, ready, init, signUp, signIn, signOut }
}

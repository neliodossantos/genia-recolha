export default defineNuxtRouteMiddleware(async (to) => {
  const { init, session } = useAuth()
  await init()

  if (!session.value && to.path !== '/login') return navigateTo('/login')
  if (session.value && to.path === '/login') return navigateTo('/')
})

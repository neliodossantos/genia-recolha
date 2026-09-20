<script setup lang="ts">
const { signIn, signUp } = useAuth()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    if (mode.value === 'register') await signUp(username.value, password.value)
    else await signIn(username.value, password.value)
    await navigateTo('/')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Ocorreu um erro.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center p-4">
    <UCard class="w-full max-w-sm">
      <template #header>
        <h1 class="text-xl font-semibold">Recolha de gestos LGA</h1>
        <p class="text-sm text-muted">
          {{ mode === 'login' ? 'Entra para continuar.' : 'Cria uma conta simples.' }}
        </p>
      </template>

      <form class="space-y-4" @submit.prevent="submit">
        <UFormField label="Nome">
          <UInput v-model="username" class="w-full" autocomplete="username" />
        </UFormField>
        <UFormField label="Palavra-passe (mínimo 6 caracteres)">
          <UInput
            v-model="password"
            type="password"
            class="w-full"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          />
        </UFormField>
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UButton type="submit" block :loading="loading">
          {{ mode === 'login' ? 'Entrar' : 'Criar conta' }}
        </UButton>
      </form>

      <template #footer>
        <UButton
          variant="link"
          size="sm"
          @click="() => { mode = mode === 'login' ? 'register' : 'login' }"
        >
          {{ mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta' }}
        </UButton>
      </template>
    </UCard>
  </div>
</template>

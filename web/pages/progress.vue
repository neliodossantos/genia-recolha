<script setup lang="ts">
const { $supabase } = useNuxtApp()
const { session } = useAuth()

interface Row {
  id: number
  word: string
  done: number
}

const rows = ref<Row[]>([])
const error = ref('')

onMounted(async () => {
  const userId = session.value!.user.id
  const [vocab, progress] = await Promise.all([
    $supabase.from('vocabulary').select('id, word').eq('active', true).order('position'),
    $supabase.from('recording_counts').select('word_id, count').eq('user_id', userId),
  ])
  if (vocab.error || progress.error) {
    error.value = (vocab.error ?? progress.error)!.message
    return
  }
  const counts = Object.fromEntries(progress.data.map((r) => [r.word_id, r.count]))
  rows.value = vocab.data.map((w) => ({ id: w.id, word: w.word, done: counts[w.id] ?? 0 }))
})
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-4">
    <UButton to="/" variant="ghost" size="sm">← Voltar a gravar</UButton>
    <h1 class="text-2xl font-semibold">O meu progresso</h1>
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    <div v-for="row in rows" :key="row.id" class="space-y-1">
      <div class="flex justify-between text-sm">
        <span>{{ row.word }}</span>
        <span>{{ row.done }}/{{ TARGET_PER_WORD }}</span>
      </div>
      <UProgress :model-value="Math.min(row.done, TARGET_PER_WORD)" :max="TARGET_PER_WORD" />
    </div>
  </div>
</template>

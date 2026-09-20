<script setup lang="ts">
import { toCsv } from '~/utils/csv'

const { $supabase } = useNuxtApp()
const { session } = useAuth()

const isAdmin = ref<boolean | null>(null)
const error = ref('')
const perSigner = ref<{ username: string; total: number }[]>([])
const perWord = ref<{ word: string; total: number }[]>([])

const PAGE = 1000

async function fetchAllRecordings() {
  const all: Record<string, string | number | null>[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error: err } = await $supabase
      .from('recordings')
      .select('id, user_id, word_id, video_key, landmarks_key, duration_ms, width, height, mime, created_at')
      .order('created_at')
      .range(from, from + PAGE - 1)
    if (err) throw new Error(err.message)
    all.push(...(data as Record<string, string | number | null>[]))
    if (data.length < PAGE) return all
  }
}

onMounted(async () => {
  const me = await $supabase.from('profiles').select('role').eq('id', session.value!.user.id).single()
  isAdmin.value = me.data?.role === 'admin'
  if (!isAdmin.value) return

  const [counts, profiles, vocab] = await Promise.all([
    $supabase.from('recording_counts').select('user_id, word_id, count'),
    $supabase.from('profiles').select('id, username'),
    $supabase.from('vocabulary').select('id, word').order('position'),
  ])
  if (counts.error || profiles.error || vocab.error) {
    error.value = (counts.error ?? profiles.error ?? vocab.error)!.message
    return
  }

  const usernames = Object.fromEntries(profiles.data.map((p) => [p.id, p.username]))
  const words = Object.fromEntries(vocab.data.map((w) => [w.id, w.word]))
  const signerTotals: Record<string, number> = {}
  const wordTotals: Record<number, number> = {}
  for (const row of counts.data) {
    signerTotals[row.user_id] = (signerTotals[row.user_id] ?? 0) + row.count
    wordTotals[row.word_id] = (wordTotals[row.word_id] ?? 0) + row.count
  }
  perSigner.value = Object.entries(signerTotals).map(([id, total]) => ({
    username: usernames[id] ?? id,
    total,
  }))
  perWord.value = vocab.data.map((w) => ({ word: words[w.id], total: wordTotals[w.id] ?? 0 }))
})

async function exportCsv() {
  try {
    const rows = await fetchAllRecordings()
    const csv = toCsv(rows, [
      'id', 'user_id', 'word_id', 'video_key', 'landmarks_key',
      'duration_ms', 'width', 'height', 'mime', 'created_at',
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'recordings.csv'
    link.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Erro ao exportar.'
  }
}
</script>

<template>
  <div class="mx-auto max-w-2xl p-4 space-y-6">
    <UButton to="/" variant="ghost" size="sm">← Voltar a gravar</UButton>
    <h1 class="text-2xl font-semibold">Administração</h1>

    <UAlert v-if="isAdmin === false" color="warning" variant="subtle" title="Esta página é só para administradores." />
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />

    <template v-if="isAdmin">
      <UButton @click="exportCsv">Exportar metadados (CSV)</UButton>

      <section>
        <h2 class="font-medium mb-2">Gravações por sinalizante</h2>
        <ul class="text-sm space-y-1">
          <li v-for="s in perSigner" :key="s.username" class="flex justify-between">
            <span>{{ s.username }}</span><span>{{ s.total }}</span>
          </li>
        </ul>
      </section>

      <section>
        <h2 class="font-medium mb-2">Gravações por palavra</h2>
        <ul class="text-sm space-y-1">
          <li v-for="w in perWord" :key="w.word" class="flex justify-between">
            <span>{{ w.word }}</span><span>{{ w.total }}</span>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

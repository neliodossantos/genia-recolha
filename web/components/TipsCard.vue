<script setup lang="ts">
const tips = [
  { title: 'Luz de frente', text: 'Vira-te para uma janela ou acende uma luz à tua frente. Evita ter a luz nas costas.' },
  { title: 'Mãos sempre visíveis', text: 'Mantém as duas mãos dentro do enquadramento durante todo o gesto.' },
  { title: 'Distância certa', text: 'Fica a cerca de um metro da câmara, de forma a ver a cabeça, o peito e as mãos.' },
  { title: 'Fundo simples', text: 'Um fundo liso ajuda a detetar as mãos. Tira objetos e pessoas que se mexam atrás de ti.' },
  { title: 'Como grava', text: 'Carregas em Gravar, esperas a contagem de 3 e fazes o gesto. Carrega em Parar quando acabares.' },
]
</script>

<template>
  <ol class="space-y-3">
    <li v-for="(tip, i) in tips" :key="tip.title" class="flex gap-3">
      <span
        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary"
      >
        {{ i + 1 }}
      </span>
      <div>
        <p class="font-medium">{{ tip.title }}</p>
        <p class="text-sm text-muted">{{ tip.text }}</p>
      </div>
    </li>
  </ol>
</template>

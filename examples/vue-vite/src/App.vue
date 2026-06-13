<template>
  <main class="page">
    <h1 class="title">Pointcut tracer bullet</h1>
    <p class="lede">
      Click <strong>pick</strong> (bottom-right), then click any element below.
      Your editor opens at that element's exact spot in this file.
    </p>
    <section class="card">
      <h2>A card</h2>
      <button class="cta">Primary action</button>
      <button class="cta ghost">Secondary</button>
    </section>
    <ul class="list">
      <li v-for="item in items" :key="item">{{ item }}</li>
    </ul>
  </main>
</template>

<script setup>
import { ref } from 'vue';

const items = ref(['one', 'two', 'three']);
</script>

<style>
.page { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 16px; }
.title { font-size: 28px; }
.card { border: 1px solid #ddd; border-radius: 12px; padding: 16px; margin: 24px 0; }
.cta { padding: 8px 14px; border-radius: 8px; border: none; background: #11141a; color: #fff; cursor: pointer; }
.cta.ghost { background: transparent; color: #11141a; border: 1px solid #11141a; }
.list { line-height: 2; }
</style>

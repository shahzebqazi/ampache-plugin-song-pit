<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { mountCrtBackground } from './lib/crtBackground';

  interface Props {
    imageUrl: string;
  }
  let { imageUrl }: Props = $props();

  let canvasEl: HTMLCanvasElement | null = $state(null);
  let mode = $state<'crt' | 'css'>('crt');

  onMount(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      await tick();
      const el = canvasEl;
      if (!el) {
        mode = 'css';
        return;
      }
      const c = await mountCrtBackground(el, imageUrl);
      if (cancelled) {
        c?.();
        return;
      }
      if (!c) {
        mode = 'css';
      } else {
        cleanup = c;
      }
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  });
</script>

{#if mode === 'crt'}
  <canvas class="pa2-matrix-bg" bind:this={canvasEl} aria-hidden="true"></canvas>
{:else}
  <div class="pa2-matrix-bg" aria-hidden="true" style={`background-image: url('${imageUrl}')`}></div>
{/if}

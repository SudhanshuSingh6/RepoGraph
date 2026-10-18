<script lang="ts">
	// repograph-spec.md §5.2/§18: full-screen overlay, message + animated progress bar.
	// `fraction` null = indeterminate (e.g. waiting on the server).
	let { message, fraction = null }: { message: string; fraction?: number | null } = $props();
</script>

<div class="loading" role="status" aria-live="polite">
	<div class="box">
		<p>{message}</p>
		<div class="track" class:indeterminate={fraction === null}>
			<div
				class="fill"
				style:width={fraction === null ? null : `${Math.round(fraction * 100)}%`}
			></div>
		</div>
	</div>
</div>

<style>
	.loading {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		backdrop-filter: blur(2px);
	}

	.box {
		width: min(360px, calc(100vw - 32px));
		padding: 20px 22px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
	}

	p {
		margin: 0 0 12px;
		font-weight: 600;
	}

	.track {
		height: 6px;
		border-radius: 999px;
		background: var(--panel2);
		overflow: hidden;
	}

	.fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.15s ease;
	}

	.indeterminate .fill {
		width: 35%;
		animation: slide 1.2s ease-in-out infinite;
	}

	@keyframes slide {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(290%);
		}
	}
</style>

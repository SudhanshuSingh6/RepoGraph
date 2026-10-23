<script lang="ts">
	import { PROVIDERS, PROVIDER_NAMES, type ProviderId, type SavedKey } from '#lib/chat/shared.ts';

	let {
		keys,
		onchange,
		onclose
	}: {
		keys: SavedKey[];
		onchange: (keys: SavedKey[]) => void;
		onclose: () => void;
	} = $props();

	const saved = (p: ProviderId) => keys.find((k) => k.provider === p) ?? null;

	// Start on the active provider, or the first one with nothing saved yet.
	// svelte-ignore state_referenced_locally
	let provider = $state<ProviderId>(keys.find((k) => k.active)?.provider ?? 'openai');
	let apiKey = $state('');
	// svelte-ignore state_referenced_locally
	let model = $state(saved(provider)?.model ?? '');
	let models = $state<string[]>([]);
	let busy = $state<'models' | 'save' | 'remove' | 'use' | null>(null);
	let errors = $state<{ key?: string; model?: string; general?: string }>({});
	let notice = $state<string | null>(null);

	function pick(p: ProviderId) {
		provider = p;
		apiKey = '';
		model = saved(p)?.model ?? '';
		models = [];
		errors = {};
		notice = null;
	}

	async function call(url: string, method: string, body: unknown) {
		const res = await fetch(url, {
			method,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		return { res, data };
	}

	/** Routes a failure to the field it belongs to. */
	function show(res: Response, data: { error?: string; message?: string }) {
		const message = data.message ?? `Something went wrong (${res.status}).`;
		if (data.error === 'unsupported_model') errors = { model: message };
		else if (data.error === 'key_rejected' || /key/i.test(message)) errors = { key: message };
		else errors = { general: message };
	}

	async function loadModels() {
		busy = 'models';
		errors = {};
		try {
			const { res, data } = await call('/api/chat/models', 'POST', { provider, apiKey });
			if (res.ok) models = data.models;
			else show(res, data);
		} finally {
			busy = null;
		}
	}

	async function save() {
		busy = 'save';
		errors = {};
		notice = null;
		try {
			const fresh = apiKey.trim() !== '';
			const { res, data } = fresh
				? await call('/api/chat/keys', 'POST', { provider, apiKey, model })
				: await call('/api/chat/keys', 'PATCH', { provider, model });
			if (!res.ok) return show(res, data);
			apiKey = '';
			onchange(data.keys);
			notice = `Saved. Chat now uses ${PROVIDER_NAMES[provider]} · ${model.trim()}.`;
		} finally {
			busy = null;
		}
	}

	async function use(p: ProviderId) {
		busy = 'use';
		errors = {};
		try {
			const { res, data } = await call('/api/chat/keys', 'PATCH', { provider: p });
			if (res.ok) onchange(data.keys);
			else show(res, data);
		} finally {
			busy = null;
		}
	}

	async function remove(p: ProviderId) {
		busy = 'remove';
		errors = {};
		try {
			const { res, data } = await call('/api/chat/keys', 'DELETE', { provider: p });
			if (res.ok) {
				onchange(data.keys);
				if (p === provider) pick(p);
			} else show(res, data);
		} finally {
			busy = null;
		}
	}

	const current = $derived(saved(provider));
	const canSave = $derived(
		busy === null && model.trim() !== '' && (apiKey.trim() !== '' || current !== null)
	);
</script>

<div class="settings">
	<div class="head">
		<h3>Model connection</h3>
		<button class="link" type="button" onclick={onclose}>Done</button>
	</div>

	{#if keys.length > 0}
		<ul class="saved" aria-label="Saved keys">
			{#each keys as k (k.provider)}
				<li class:active={k.active}>
					<span class="who">
						<b>{PROVIDER_NAMES[k.provider]}</b>
						<span class="mono">{k.hint}</span>
						<span class="mono muted">{k.model}</span>
					</span>
					{#if k.active}
						<span class="tag">Active</span>
					{:else}
						<button
							class="link"
							type="button"
							disabled={busy !== null}
							onclick={() => use(k.provider)}
						>
							Use
						</button>
					{/if}
					<button
						class="link"
						type="button"
						disabled={busy !== null}
						onclick={() => remove(k.provider)}
					>
						Remove
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	<form
		onsubmit={(e) => {
			e.preventDefault();
			if (canSave) save();
		}}
	>
		<label class="field">
			<span>Provider</span>
			<select value={provider} onchange={(e) => pick(e.currentTarget.value as ProviderId)}>
				{#each PROVIDERS as p (p)}
					<option value={p}>{PROVIDER_NAMES[p]}</option>
				{/each}
			</select>
		</label>

		<label class="field">
			<span>API key</span>
			<input
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder={current
					? `Saved (${current.hint}) — enter a new one to replace it`
					: 'Paste your key'}
				bind:value={apiKey}
			/>
			{#if errors.key}<span class="err">{errors.key}</span>{/if}
		</label>

		<label class="field">
			<span>Model</span>
			<span class="row">
				<input
					type="text"
					autocomplete="off"
					spellcheck="false"
					list="chat-models"
					placeholder="Type a model ID or load the list"
					bind:value={model}
				/>
				<button
					class="btn"
					type="button"
					disabled={busy !== null || (apiKey.trim() === '' && !current)}
					onclick={loadModels}
				>
					{busy === 'models' ? 'Loading…' : 'Load models'}
				</button>
			</span>
			<datalist id="chat-models">
				{#each models as m (m)}<option value={m}></option>{/each}
			</datalist>
			{#if models.length > 0}
				<span class="muted small">
					{models.length} suggestions. Not every listed model works here; we check when you save.
				</span>
			{/if}
			{#if errors.model}<span class="err">{errors.model}</span>{/if}
		</label>

		{#if errors.general}<p class="err">{errors.general}</p>{/if}
		{#if notice}<p class="ok">{notice}</p>{/if}

		<button class="btn primary" type="submit" disabled={!canSave}>
			{busy === 'save' ? 'Checking…' : 'Save'}
		</button>
	</form>

	<p class="muted small">
		Your key is stored encrypted and used only for your own chats; it is never shown again. Saving
		sends one tiny test request, billed to your key, to check the model works here.
	</p>
</div>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h3 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 15px;
	}

	.saved {
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--line);
		border-radius: 10px;
	}

	.saved li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-top: 1px solid var(--line);
	}

	.saved li:first-child {
		border-top: none;
	}

	.who {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 8px;
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.tag {
		font-size: 11px;
		font-weight: 700;
		color: var(--panel);
		background: var(--ink);
		border-radius: 999px;
		padding: 1px 8px;
	}

	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12.5px;
		font-weight: 600;
	}

	.row {
		display: flex;
		gap: 6px;
	}

	input,
	select {
		font: inherit;
		font-weight: 400;
		font-size: 13px;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 6px 8px;
		min-width: 0;
		flex: 1;
	}

	.mono {
		font-family: var(--font-mono);
		font-size: 12px;
	}

	.muted {
		color: var(--muted);
	}

	.small {
		font-size: 12px;
		font-weight: 400;
		margin: 0;
	}

	.err {
		color: var(--accent);
		font-weight: 600;
		font-size: 12.5px;
		margin: 0;
	}

	.ok {
		margin: 0;
		font-size: 12.5px;
	}

	.btn {
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px 12px;
		cursor: pointer;
		white-space: nowrap;
	}

	.btn.primary {
		align-self: flex-start;
		color: var(--panel);
		background: var(--ink);
		border-color: var(--ink);
	}

	.btn:disabled,
	.link:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.link {
		font: inherit;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--ink);
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
	}
</style>

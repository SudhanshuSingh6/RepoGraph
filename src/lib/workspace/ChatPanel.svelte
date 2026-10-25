<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		MAX_TURN_CHARS,
		MAX_TURNS,
		PROVIDER_NAMES,
		type ChatReply,
		type ChatTurn,
		type SavedKey
	} from '#lib/chat/shared.ts';
	import ChatSettings from './ChatSettings.svelte';
	import { chatBlocks } from './chatText.ts';
	import type { Workspace } from './state.svelte.ts';

	let {
		ws,
		available,
		signedIn,
		hidden = false
	}: { ws: Workspace; available: boolean; signedIn: boolean; hidden?: boolean } = $props();

	// repograph-spec.md §17, verbatim.
	const STARTERS = [
		'What does this codebase do, at a glance?',
		'Which file would be riskiest to change?',
		'Explain any import cycles and how to break them.',
		'Where should I start reading this code?'
	];

	let keys = $state<SavedKey[] | null>(null);
	let keysError = $state<string | null>(null);
	let settingsOpen = $state(false);
	let draft = $state('');
	let sending = $state(false);
	let list = $state<HTMLDivElement>();
	let input = $state<HTMLTextAreaElement>();

	const active = $derived(keys?.find((k) => k.active) ?? null);
	const ready = $derived(available && signedIn && active !== null);

	$effect(() => {
		if (!available || !signedIn) return;
		fetch('/api/chat/keys')
			.then(async (res) => {
				if (!res.ok) throw new Error(`Couldn't load your chat settings (${res.status}).`);
				keys = (await res.json()).keys;
			})
			.catch((e: Error) => (keysError = e.message));
	});

	/** The conversation to send: answered exchanges only (a failed reply drops its
	 * question too), the most recent that fit, then the new question. */
	function history(question: string): ChatTurn[] {
		const pairs: ChatTurn[][] = [];
		ws.chat.forEach((m, i) => {
			const next = ws.chat[i + 1];
			if (m.role === 'user' && next?.role === 'assistant' && !next.failed) {
				pairs.push([
					{ role: 'user', content: m.text },
					{ role: 'assistant', content: next.text.slice(0, MAX_TURN_CHARS) }
				]);
			}
		});
		const room = Math.floor((MAX_TURNS - 1) / 2);
		return [...pairs.slice(-room).flat(), { role: 'user', content: question }];
	}

	async function scrollDown() {
		await tick();
		list?.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
	}

	async function send() {
		const question = draft.trim();
		if (!question || !ready || sending) return;
		const turns = history(question);
		ws.chat.push({ role: 'user', text: question });
		draft = '';
		sending = true;
		scrollDown();
		try {
			const res = await fetch(`/api/projects/${ws.id}/chat`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ messages: turns })
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok) {
				const reply = data as ChatReply;
				ws.chat.push({ role: 'assistant', text: reply.reply, filesRead: reply.filesRead });
			} else {
				ws.chat.push({
					role: 'assistant',
					failed: true,
					text: data.message ?? `Something went wrong (${res.status}).`
				});
				// The model stopped working (or the key went away): its settings need a look.
				if (data.error === 'unsupported_model') {
					keys = keys?.map((k) => (k.active ? { ...k, verified: false } : k)) ?? null;
				}
				if (res.status === 412) keys = [];
			}
		} catch {
			ws.chat.push({
				role: 'assistant',
				failed: true,
				text: "Couldn't reach the server. Try again."
			});
		} finally {
			sending = false;
			scrollDown();
		}
	}

	function starter(text: string) {
		draft = text;
		input?.focus();
	}

	/** The textarea grows with its content, up to a cap. */
	function grow(el: HTMLTextAreaElement) {
		$effect(() => {
			void draft;
			el.style.height = 'auto';
			el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
		});
	}
</script>

<div class="chat-panel" id="chat-panel" {hidden}>
	<div class="head">
		<h2>Ask the codebase</h2>
		{#if available && signedIn && keys !== null}
			<button
				class="gear"
				type="button"
				aria-label="Model settings"
				aria-pressed={settingsOpen}
				title="Model settings"
				onclick={() => (settingsOpen = !settingsOpen)}
			>
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
					<path
						fill="currentColor"
						d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.3 7.3 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.3 7.3 0 0 0 1.7-1l2.4 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
						transform="translate(-1 0)"
					/>
				</svg>
			</button>
		{/if}
	</div>

	<div class="messages" bind:this={list}>
		{#if settingsOpen && keys !== null}
			<ChatSettings
				{keys}
				onchange={(k) => (keys = k)}
				onclose={() => {
					settingsOpen = false;
					input?.focus();
				}}
			/>
		{:else}
			{#if ws.chat.length === 0}
				<div class="intro">
					<p>
						Ask anything about this repository. The assistant can open files, search paths and walk
						folders before it answers, and it always sees every file, whatever the filters show.
					</p>
					<div class="chips">
						{#each STARTERS as s (s)}
							<button class="chip" type="button" onclick={() => starter(s)}>{s}</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each ws.chat as m, i (i)}
				<div class="msg {m.role}" class:failed={m.failed}>
					{#if m.role === 'user' || m.failed}
						<p class="plain">{m.text}</p>
					{:else}
						{#each chatBlocks(m.text) as b, j (j)}
							{#if b.kind === 'code'}
								<pre><code>{b.text}</code></pre>
							{:else}
								<p>
									{#each b.parts as part, k (k)}{#if part.code}<code>{part.text}</code
											>{:else}{part.text}{/if}{/each}
								</p>
							{/if}
						{/each}
						{#if m.filesRead?.length}
							<p class="read">Read {m.filesRead.join(', ')}</p>
						{/if}
					{/if}
				</div>
			{/each}

			{#if sending}
				<div class="msg assistant typing" aria-label="The assistant is typing">
					<span></span><span></span><span></span>
				</div>
			{/if}
		{/if}
	</div>

	<form
		class="input"
		onsubmit={(e) => {
			e.preventDefault();
			send();
		}}
	>
		<textarea
			bind:this={input}
			bind:value={draft}
			use:grow
			rows="1"
			maxlength={MAX_TURN_CHARS}
			placeholder="Ask about this code…"
			aria-label="Your question"
			onkeydown={(e) => {
				if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
					e.preventDefault();
					send();
				}
			}}></textarea>
		<button class="send" type="submit" disabled={!ready || sending || draft.trim() === ''}
			>Send</button
		>
	</form>

	<p class="status">
		{#if !available}
			Chat is currently unavailable.
		{:else if !signedIn}
			<a href={resolve('/auth/github')} data-sveltekit-reload>Sign in with GitHub</a> to ask questions
			about this code.
		{:else if keysError}
			<span class="bad">{keysError}</span>
		{:else if keys === null}
			Checking your model connection…
		{:else if !active}
			<button class="link" type="button" onclick={() => (settingsOpen = true)}>
				Connect a model to start chatting
			</button>
			— bring your own OpenAI, Claude, Gemini or Grok key.
		{:else}
			{PROVIDER_NAMES[active.provider]} · <span class="mono">{active.model}</span>
			{#if !active.verified}
				· <button class="link" type="button" onclick={() => (settingsOpen = true)}
					>check model</button
				>
			{/if}
		{/if}
	</p>
</div>

<style>
	/* Closed from the toolbar: stays mounted (a reply in flight, a draft and the key
	   settings survive), just out of the layout. */
	.chat-panel[hidden] {
		display: none;
	}

	.chat-panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
		border-left: 1px solid var(--line);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px 10px;
		border-bottom: 1px solid var(--line);
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 18px;
	}

	.gear {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		color: var(--muted);
		background: none;
		border: 1px solid transparent;
		border-radius: 8px;
		cursor: pointer;
	}

	.gear:hover,
	.gear[aria-pressed='true'] {
		color: var(--ink);
		border-color: var(--line);
	}

	.messages {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 18px;
	}

	.intro p {
		margin: 0 0 12px;
		color: var(--muted);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		font: inherit;
		font-size: 12.5px;
		text-align: left;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 999px;
		padding: 5px 12px;
		cursor: pointer;
	}

	.chip:hover {
		border-color: var(--ink);
	}

	.msg {
		max-width: 88%;
		padding: 8px 12px;
		border-radius: 12px;
		overflow-wrap: anywhere;
	}

	.msg.user {
		align-self: flex-end;
		color: var(--panel);
		background: var(--ink);
		border-bottom-right-radius: 4px;
	}

	.msg.assistant {
		align-self: flex-start;
		background: var(--panel2);
		border: 1px solid var(--line);
		border-bottom-left-radius: 4px;
	}

	.msg.failed {
		color: var(--accent);
		border-color: var(--accent);
	}

	.msg p {
		margin: 0 0 8px;
		white-space: pre-wrap;
	}

	.msg p:last-child {
		margin-bottom: 0;
	}

	.msg code {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--panel);
		border-radius: 4px;
		padding: 0 3px;
	}

	.msg pre {
		margin: 0 0 8px;
		padding: 8px 10px;
		overflow: auto;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 8px;
	}

	.msg pre code {
		padding: 0;
		background: none;
		white-space: pre;
	}

	.read {
		font-size: 11.5px;
		color: var(--muted);
	}

	.typing {
		display: flex;
		gap: 4px;
		padding: 12px 14px;
	}

	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--muted);
		animation: blink 1.2s infinite ease-in-out;
	}

	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes blink {
		0%,
		80%,
		100% {
			opacity: 0.25;
			transform: translateY(0);
		}
		40% {
			opacity: 1;
			transform: translateY(-3px);
		}
	}

	.input {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 10px 18px 6px;
		border-top: 1px solid var(--line);
	}

	textarea {
		flex: 1;
		min-width: 0;
		resize: none;
		font: inherit;
		color: var(--ink);
		background: var(--panel2);
		border: 1px solid var(--line);
		border-radius: 10px;
		padding: 7px 10px;
	}

	.send {
		font: inherit;
		font-weight: 600;
		color: var(--panel);
		background: var(--ink);
		border: 1px solid var(--ink);
		border-radius: 999px;
		padding: 6px 16px;
		cursor: pointer;
	}

	.send:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.status {
		margin: 0;
		padding: 0 18px 10px;
		font-size: 12px;
		color: var(--muted);
	}

	.status a,
	.link {
		font: inherit;
		color: var(--ink);
		font-weight: 600;
		background: none;
		border: none;
		padding: 0;
		text-decoration: underline;
		cursor: pointer;
	}

	.mono {
		font-family: var(--font-mono);
	}

	.bad {
		color: var(--accent);
	}
</style>

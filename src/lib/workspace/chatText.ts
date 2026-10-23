// Markdown-lite for assistant replies (repograph-spec.md §17): fenced code blocks and
// inline code, nothing else. Returns plain data the panel renders as text nodes, so a
// reply can never inject markup.

export type Inline = { code: boolean; text: string };
export type Block =
	{ kind: 'code'; lang: string; text: string } | { kind: 'text'; parts: Inline[] };

const FENCE = /```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(?:\n?```|$)/g;

export function inlineParts(text: string): Inline[] {
	const parts: Inline[] = [];
	let last = 0;
	for (const m of text.matchAll(/`([^`\n]+)`/g)) {
		if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) });
		parts.push({ code: true, text: m[1] });
		last = m.index + m[0].length;
	}
	if (last < text.length) parts.push({ code: false, text: text.slice(last) });
	return parts;
}

export function chatBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	const prose = (s: string) => {
		const t = s.replace(/^\n+|\n+$/g, '');
		if (t.trim()) blocks.push({ kind: 'text', parts: inlineParts(t) });
	};
	let last = 0;
	for (const m of text.matchAll(FENCE)) {
		prose(text.slice(last, m.index));
		blocks.push({ kind: 'code', lang: m[1], text: m[2] });
		last = m.index + m[0].length;
	}
	prose(text.slice(last));
	return blocks;
}

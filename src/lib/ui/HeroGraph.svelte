<script lang="ts">
	// repograph-spec.md §4: a procedurally drawn example dependency graph. 13 nodes
	// [x, y, radius, lang] in a 420×320 viewBox, 15 directed edges; 5→6→7→5 is the one
	// highlighted cycle. Endpoints stop at each circle's edge, not its center.
	const nodes: [number, number, number, 'java' | 'js' | 'ts' | 'py'][] = [
		[62, 58, 10, 'ts'],
		[150, 38, 8, 'js'],
		[246, 56, 12, 'ts'],
		[348, 44, 9, 'py'],
		[88, 152, 13, 'java'],
		[196, 138, 11, 'ts'],
		[290, 176, 10, 'js'],
		[204, 236, 9, 'ts'],
		[364, 136, 12, 'py'],
		[56, 252, 9, 'java'],
		[128, 290, 7, 'java'],
		[300, 272, 11, 'py'],
		[382, 246, 8, 'py']
	];
	const edges: [number, number][] = [
		[0, 1],
		[0, 4],
		[1, 2],
		[2, 3],
		[2, 5],
		[4, 5],
		[4, 9],
		[9, 10],
		[3, 8],
		[8, 12],
		[6, 11],
		[11, 12],
		[5, 6],
		[6, 7],
		[7, 5]
	];
	const cycle = new Set(['5-6', '6-7', '7-5']);
	const ARROW_GAP = 3;

	const lines = edges.map(([a, b]) => {
		const [x1, y1, r1] = nodes[a];
		const [x2, y2, r2] = nodes[b];
		const len = Math.hypot(x2 - x1, y2 - y1);
		const ux = (x2 - x1) / len;
		const uy = (y2 - y1) / len;
		return {
			x1: x1 + ux * r1,
			y1: y1 + uy * r1,
			x2: x2 - ux * (r2 + ARROW_GAP),
			y2: y2 - uy * (r2 + ARROW_GAP),
			hot: cycle.has(`${a}-${b}`)
		};
	});
</script>

<figure class="hero-graph">
	<svg viewBox="0 0 420 320" role="img" aria-label="Example dependency graph with one import cycle">
		<defs>
			<marker
				id="hg-arrow"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="6"
				markerHeight="6"
				orient="auto-start-reverse"
			>
				<path d="M0,0 L10,5 L0,10 z" fill="var(--edge)" />
			</marker>
			<marker
				id="hg-arrow-hot"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="5"
				markerHeight="5"
				orient="auto-start-reverse"
			>
				<path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
			</marker>
		</defs>
		{#each lines as l, i (i)}
			<line
				x1={l.x1}
				y1={l.y1}
				x2={l.x2}
				y2={l.y2}
				class:hot={l.hot}
				marker-end={l.hot ? 'url(#hg-arrow-hot)' : 'url(#hg-arrow)'}
			/>
		{/each}
		{#each nodes as [x, y, r, lang], i (i)}
			<circle cx={x} cy={y} {r} fill="var(--lang-{lang})" />
		{/each}
	</svg>
	<figcaption>
		Circles are files, arrows are imports. The three magenta arrows form an import cycle.
	</figcaption>
</figure>

<style>
	.hero-graph {
		margin: 0;
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
	}

	line {
		stroke: var(--edge);
		stroke-width: 1.4;
	}

	line.hot {
		stroke: var(--accent);
		stroke-width: 2.6;
	}

	circle {
		stroke: var(--panel);
		stroke-width: 2;
	}

	figcaption {
		margin-top: 10px;
		color: var(--muted);
		font-size: 13px;
		text-align: center;
	}
</style>

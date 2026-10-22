import { describe, expect, it } from 'vitest';
import type { EntityDecl } from '#analysis/types/index.ts';
import { MAX_FIELDS, erDiagram, fieldRows } from './erModel.ts';

function entity(file: number, name: string, fields = 0): EntityDecl {
	return {
		file,
		name,
		table: name.toLowerCase(),
		orm: 'jpa',
		fields: Array.from({ length: fields }, (_, i) => ({
			name: i === 0 ? 'id' : `f${i}`,
			type: i === 0 ? 'Long' : '',
			pk: i === 0
		})),
		relations: [],
		line: 1
	};
}

describe('erDiagram', () => {
	it('keeps entities in active files and the edges between them', () => {
		const entities = [entity(0, 'A'), entity(1, 'B'), entity(2, 'C')];
		const edges = [
			{ from: 0, to: 1, field: 'b', kind: 'N–1' as const },
			{ from: 0, to: 2, field: 'c', kind: '1–N' as const },
			{ from: 0, to: 0, field: 'self', kind: '1–1' as const }
		];
		expect(erDiagram(entities, edges, [true, true, false])).toEqual({
			shown: [0, 1],
			edges: [edges[0], edges[2]]
		});
	});
});

describe('fieldRows', () => {
	it('bolds primary keys and omits a missing type', () => {
		expect(fieldRows(entity(0, 'A', 2))).toEqual({
			rows: [
				{ text: 'id: Long', bold: true },
				{ text: 'f1', bold: false }
			],
			more: 0
		});
	});

	it(`shows at most ${MAX_FIELDS} fields, then counts the rest`, () => {
		expect(fieldRows(entity(0, 'A', MAX_FIELDS)).more).toBe(0);
		const long = fieldRows(entity(0, 'A', 13));
		expect(long.rows).toHaveLength(MAX_FIELDS);
		expect(long.more).toBe(5);
	});
});

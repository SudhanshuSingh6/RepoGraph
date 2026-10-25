// A function's statement tree as the worker stores it (workers/structure.py). Text is
// source text, collapsed onto one line and capped; `calls` index the function's calls,
// in evaluation order.

/** `fullLength`: set when the worker shortened `text` (its cap is 400 characters). */
export type Part = { text: string; calls: number[]; fullLength?: number };

export type Case = {
	line: number;
	labels: string[];
	isDefault: boolean;
	body: Step[];
	guard?: Part | null; // Python `case … if guard`
};

export type Catch = {
	line: number;
	types: string[] | null; // null: catches anything (JS, bare `except:`)
	name: string | null;
	body: Step[];
};

export type Step =
	| { kind: 'stmt'; line: number; text: string; calls: number[]; fullLength?: number }
	| { kind: 'if'; line: number; cond: Part; then: Step[]; else: Step[] | null }
	| {
			kind: 'loop';
			line: number;
			label: string | null;
			loop: 'while' | 'do' | 'for' | 'foreach';
			cond: Part | null;
			init: Step[] | null;
			update: Part | null;
			item: string | null;
			iterable: Part | null;
			body: Step[];
			orelse: Step[] | null; // Python: runs when the loop ends without `break`
	  }
	| {
			kind: 'switch';
			line: number;
			label: string | null;
			subject: Part;
			cases: Case[];
			arrow: boolean; // Java `case X ->`: no fall-through
			hasDefault: boolean;
	  }
	| {
			kind: 'match';
			line: number;
			label: string | null;
			subject: Part;
			cases: Case[];
			hasDefault: boolean;
	  }
	| {
			kind: 'try';
			line: number;
			resources: Part | null; // Java try-with-resources
			body: Step[];
			catches: Catch[];
			orelse: Step[] | null; // Python `try … else`
			finally: Step[] | null;
	  }
	| { kind: 'return'; line: number; text: string; value: Part | null; fullLength?: number }
	| {
			kind: 'throw';
			line: number;
			text: string;
			fullLength?: number;
			value: Part | null;
			type: string | null; // `throw new X()` / `raise X(…)`; null: not evident
			typeChain?: string[]; // X and its supertypes, resolved in the repo (worker)
			chainComplete?: boolean; // false: the chain ends in a type outside the repo
	  }
	| { kind: 'break' | 'continue'; line: number; label: string | null }
	| { kind: 'with'; line: number; items: Part; body: Step[] }
	| {
			kind: 'block';
			line: number;
			label: string | null;
			text: string;
			calls?: number[];
			body: Step[];
	  }
	| { kind: 'truncated'; omitted: number; line?: number };

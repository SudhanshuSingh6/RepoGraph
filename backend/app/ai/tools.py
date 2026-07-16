"""Named AI tools — each builds a fully-formed prompt string for Gemini."""


def explain_node(ctx: dict) -> str:
    node = ctx["node"]
    return f"""Explain this code as if onboarding a new backend engineer joining the team.
Describe its responsibility, collaborators, lifecycle, and where it fits in the architecture.
Avoid repeating the source code verbatim. When you mention a class or method name from the
collaborators list, write it in **bold** exactly as shown.

{node.get('type', 'Node')}: {node.get('label') or node.get('name', '')}
File: {node.get('file_path', 'unknown')}
Complexity: {node.get('complexity', 'N/A')}, LOC: {node.get('lines', 'N/A')}

Source:
```{ctx['language']}
{ctx['source'][:1500]}
```

Collaborators:
- Called by: {', '.join(ctx['used_by'][:5]) or 'none'}
- Calls: {', '.join(ctx['calls'][:5]) or 'none'}
- Imports: {', '.join(ctx['imports'][:5]) or 'none'}
"""


def summarize_node(ctx: dict, method_names: list[str]) -> str:
    node = ctx["node"]
    return f"""Summarize the responsibilities of {node.get('label') or node.get('name', '')} ({node.get('type', 'Node')}) in 3-5 bullet points.
Be specific about what it DOES, not what it contains.
Each bullet must start with a verb. Do not say "contains" or "has".
When you mention a method name, write it in **bold** exactly as shown.

Methods: {', '.join(method_names[:10]) or 'none listed'}
Source:
```{ctx['language']}
{ctx['source'][:2000]}
```
"""


def impact_analysis(node: dict, affected: list[dict]) -> str:
    affected_lines = "\n".join(
        f"- {a['name']} ({a['type']}) — {a.get('file_path', '')}" for a in affected
    ) or "- (no callers or importers found)"
    return f"""A developer is about to modify {node.get('label') or node.get('name', '')} ({node.get('type', 'Node')}).
In 2-3 sentences, describe the change risk and which systems will be affected.
Then list the specific affected components by name, one per line, each name in **bold**.

Callers and importers (up to 3 hops, {len(affected)} total):
{affected_lines}
"""


def architecture_question(question: str, context_blocks: str) -> str:
    return f"""You are a code analysis assistant with access to the following component context.
Answer the question concisely. Reference specific class and method names from the context.
When you mention a class or method name, write it in **bold** exactly as it appears in the context.

Context:
{context_blocks}

Question: {question}
"""


def repo_question(question: str, context_blocks: str, language: str) -> str:
    return f"""You are a codebase assistant for a {language} project.
Answer the question using only the context provided.
Reference specific class/method names exactly as shown, in **bold**. Be concise.
End with a "Sources:" section listing the relevant files.

Context:
{context_blocks}

Question: {question}
"""

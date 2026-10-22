"""Convert KnowledgeGate's rich-text "doc" JSON into text, Markdown or HTML.

The API returns a ProseMirror-like document tree::

    {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]},
        {"type": "image", "attrs": {"src": "https://..."}},
    ]}

Node types observed in the wild: doc, paragraph, text, textStyle (bold/italic/
underline/code), codeBlock, image, bulletList, orderedList, listItem,
blockquote, hardBreak, subscript, superscript, table/row/cell.
"""

from __future__ import annotations

import html
import re
from typing import Any

BOLD_MARKS = {"bold", "strong"}
ITALIC_MARKS = {"italic", "em"}
CODE_MARKS = {"code"}
UNDERLINE_MARKS = {"underline"}
STRIKE_MARKS = {"strike", "strikethrough"}
SUBSCRIPT_MARKS = {"subscript"}
SUPERSCRIPT_MARKS = {"superscript"}


def _marks(node: dict[str, Any]) -> list[str]:
    marks = node.get("marks") or []
    out: list[str] = []
    for mark in marks:
        if not isinstance(mark, dict):
            continue
        mark_type = mark.get("type")
        if not mark_type:
            continue
        out.append(str(mark_type))
    return out


def _inline_text(node: dict[str, Any], marks: list[str], fmt: str) -> str:
    """Render a text node, applying accumulated marks."""
    text = node.get("text", "")
    if not text:
        return ""
    if fmt == "html":
        escaped = html.escape(text)
        for mark in marks:
            if mark in BOLD_MARKS:
                escaped = f"<b>{escaped}</b>"
            elif mark in ITALIC_MARKS:
                escaped = f"<i>{escaped}</i>"
            elif mark in UNDERLINE_MARKS:
                escaped = f"<u>{escaped}</u>"
            elif mark in STRIKE_MARKS:
                escaped = f"<s>{escaped}</s>"
            elif mark in CODE_MARKS:
                escaped = f"<code>{escaped}</code>"
            elif mark in SUBSCRIPT_MARKS:
                escaped = f"<sub>{escaped}</sub>"
            elif mark in SUPERSCRIPT_MARKS:
                escaped = f"<sup>{escaped}</sup>"
        return escaped
    if fmt == "markdown":
        if any(m in CODE_MARKS for m in marks):
            return f"`{text}`"
        out = text
        if any(m in BOLD_MARKS for m in marks):
            out = f"**{out}**"
        if any(m in ITALIC_MARKS for m in marks):
            out = f"*{out}*"
        if any(m in UNDERLINE_MARKS for m in marks):
            out = f"<u>{out}</u>"
        return out
    return text


def _image_attrs(node: dict[str, Any]) -> dict[str, Any]:
    attrs = node.get("attrs")
    return attrs if isinstance(attrs, dict) else {}


def _render(node: Any, fmt: str, marks: list[str] | None = None) -> str:
    """Render one node (or list of nodes) to a string."""
    if node is None:
        return ""
    marks = marks or []
    if isinstance(node, list):
        return "".join(_render(child, fmt, marks) for child in node)
    if not isinstance(node, dict):
        return str(node)

    node_type = node.get("type", "")

    if node_type == "text":
        return _inline_text(node, marks + _marks(node), fmt)

    content = node.get("content")

    if node_type in {"doc", "paragraph", "blockquote", "listItem", "tableCell"}:
        inner = _render(content, fmt, marks)
        if node_type == "paragraph":
            return inner
        if node_type == "blockquote":
            prefix = "> " if fmt != "html" else "<blockquote>"
            body = inner.replace("\n", "\n> ") if fmt != "html" else inner
            return f"{prefix}{body}\n" if fmt != "html" else f"{prefix}{body}</blockquote>"
        if node_type == "listItem":
            return inner
        return inner

    if node_type in {"bulletList", "orderedList"}:
        items = content or []
        lines: list[str] = []
        for index, item in enumerate(items, start=1):
            marker = f"{index}." if node_type == "orderedList" else "-"
            body = _render(item, fmt, marks).strip()
            if fmt == "html":
                tag = "ol" if node_type == "orderedList" else "ul"
                lines.append(f"<{tag}><li>{body}</li></{tag}>")
            else:
                lines.append(f"{marker} {body}")
        return ("\n".join(lines) + "\n") if fmt != "html" else "".join(lines)

    if node_type == "codeBlock":
        body = _render(content, fmt, marks).strip()
        if fmt == "html":
            return f"<pre><code>{html.escape(body)}</code></pre>"
        return f"```\n{body}\n```\n"

    if node_type == "hardBreak":
        return "<br>" if fmt == "html" else "\n"

    if node_type == "image":
        attrs = _image_attrs(node)
        src = attrs.get("src") or attrs.get("url") or ""
        alt = attrs.get("alt") or attrs.get("title") or "image"
        if fmt == "html":
            return f'<img src="{html.escape(str(src))}" alt="{html.escape(str(alt))}" />'
        return f"![{alt}]({src})"

    if node_type in {"table", "tableRow"}:
        rows = content or []
        rendered_rows: list[list[str]] = []
        for row in rows:
            cells = []
            for cell in row.get("content") or []:
                cells.append(_render(cell, fmt, marks).strip())
            rendered_rows.append(cells)
        if not rendered_rows:
            return ""
        if fmt == "html":
            out = ["<table>"]
            for row in rendered_rows:
                out.append("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>")
            out.append("</table>")
            return "".join(out)
        width = max(len(r) for r in rendered_rows)
        lines = []
        for index, row in enumerate(rendered_rows):
            padded = row + [""] * (width - len(row))
            lines.append(" | ".join(padded))
            if index == 0:
                lines.append(" | ".join(["---"] * width))
        return "\n".join(lines) + "\n"

    # Unknown node: fall back to rendering its children.
    return _render(content, fmt, marks)


def doc_to_text(doc: Any) -> str:
    """Plain text suitable for a PDF or a terminal."""
    if not doc:
        return ""
    raw = _render(doc, "text")
    if isinstance(raw, str):
        raw = re.sub(r"[ \t]+\n", "\n", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()
    return ""


def doc_to_markdown(doc: Any) -> str:
    """Markdown rendering, used by the `--format md` exporter."""
    if not doc:
        return ""
    return _render(doc, "markdown").strip()


def doc_to_html(doc: Any) -> str:
    """HTML fragment, used by the Next.js frontend / JSON export."""
    if not doc:
        return ""
    return _render(doc, "html").strip()


def pick_language(doc: Any, lang: str = "en") -> Any:
    """Pick the ``values[lang]`` variant of a document when present."""
    if not isinstance(doc, dict):
        return doc
    values = doc.get("values")
    if isinstance(values, dict):
        chosen = values.get(lang) or values.get("en")
        if chosen:
            return chosen
    return doc


def extract_text(doc: Any, lang: str = "en") -> str:
    """Best-effort text for a question/option/solution document.

    Accepts either a plain document or an ``*I18n`` wrapper whose ``values``
    map holds one document per language.
    """
    if not doc:
        return ""
    if isinstance(doc, dict):
        values = doc.get("values")
        if isinstance(values, dict):
            chosen = values.get(lang) or values.get("en")
            if chosen:
                return doc_to_text(chosen)
    return doc_to_text(doc)

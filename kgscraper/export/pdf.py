"""PDF export with a table of contents, questions, options and solutions."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

from ..store import Store

LETTERS = "ABCDEFGHIJ"


@dataclass
class PdfExportOptions:
    scope: str = "course"
    scope_slug: str | None = None
    kinds: tuple[str, ...] = ("pyq", "practice")
    group_by: str = "chapter"
    with_solutions: bool = False
    answer_key_only: bool = False
    questions_only: bool = False
    limit: int | None = None
    title: str | None = None
    include_toc: bool = True


@dataclass
class _Group:
    key: str
    title: str
    rows: list[Any] = field(default_factory=list)


def _scope_filters(options: PdfExportOptions) -> dict[str, Any]:
    scope = options.scope
    slug = options.scope_slug
    if scope == "subject":
        return {"subject_slug": slug}
    if scope == "chapter":
        return {"chapter_slug": slug}
    if scope == "topic":
        return {"topic_slug": slug}
    return {}


def _group_rows(store: Store, options: PdfExportOptions) -> list[_Group]:
    rows = store.questions(kinds=options.kinds, limit=options.limit, **_scope_filters(options))
    if not rows:
        return []

    groups: dict[str, _Group] = {}

    for row in rows:
        title = _group_title(store, row, options.group_by)
        key = f"{row['kind']}::{title}"
        group = groups.get(key)
        if group is None:
            group = _Group(key=key, title=title)
            groups[key] = group
        group.rows.append(row)

    ordered: list[_Group] = []
    for kind in options.kinds:
        for (group_key, group) in groups.items():
            if group_key.startswith(f"{kind}::"):
                ordered.append(group)
    return ordered


def _group_title(store: Store, row: Any, group_by: str) -> str:
    if group_by == "subject":
        return _lookup(store, "SELECT title FROM subject WHERE id=?", row["subject_id"]) or "-"
    if group_by == "chapter":
        return _lookup(store, "SELECT title FROM chapter WHERE id=?", row["chapter_id"]) or "-"
    if group_by == "topic":
        return _lookup(store, "SELECT title FROM topic WHERE id=?", row["topic_id"]) or "-"
    if group_by == "exam":
        return row["exam_name"] or row["exam_label"] or "Exam"
    if group_by == "year":
        return str(row["year"] or "Year unknown")
    return "Questions"


def _lookup(store: Store, sql: str, param: Any) -> str | None:
    if not param:
        return None
    found = store.conn.execute(sql, (param,)).fetchone()
    return found[0] if found else None


def _escape(text: str) -> str:
    return (
        (text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def export_pdf(store: Store, options: PdfExportOptions, out_path: Path) -> Path:
    """Render the selected questions to a PDF file."""
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_LEFT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        KeepTogether,
        PageBreak,
        PageTemplate,
        Paragraph,
        Spacer,
        Table as RTable,
        TableStyle,
    )

    groups = _group_rows(store, options)
    if not groups:
        raise ValueError("No questions found for that scope.")

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    styles = getSampleStyleSheet()
    body = ParagraphStyle(
        "kgbody", parent=styles["BodyText"], fontSize=9.5, leading=13.5, alignment=TA_LEFT
    )
    body_small = ParagraphStyle("kgsmall", parent=body, fontSize=8.5, leading=11.5)
    h1 = ParagraphStyle("kgh1", parent=styles["Heading1"], fontSize=16, leading=20, spaceAfter=10)
    h2 = ParagraphStyle("kgh2", parent=styles["Heading2"], fontSize=12.5, leading=16, spaceBefore=8, spaceAfter=6)
    qstyle = ParagraphStyle("kgq", parent=body, fontSize=10, leading=14, spaceBefore=6, spaceAfter=3)
    label = ParagraphStyle("kglabel", parent=body_small, textColor=colors.HexColor("#555555"))

    course_title = options.title or _course_title(store)

    doc = BaseDocTemplate(
        str(out_path),
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=course_title,
        author="kgscrape",
    )
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="body")

    def decorate(canvas, document) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#777777"))
        canvas.drawString(doc.leftMargin, 12 * mm, course_title)
        canvas.drawRightString(A4[0] - doc.rightMargin, 12 * mm, f"page {document.page}")
        canvas.restoreState()

    doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=decorate)])

    story: list[Any] = []
    story.append(Paragraph(_escape(course_title), h1))
    story.append(
        Paragraph(
            _escape(_subtitle(store, options)),
            body_small,
        )
    )
    story.append(Spacer(1, 8))

    total_questions = sum(len(g.rows) for g in groups)
    answered = sum(1 for g in groups for r in g.rows if r["answer_available"])

    if options.include_toc:
        story.append(Paragraph("Contents", h2))
        toc_data = [["Section", "Questions", "With answers"]]
        for group in groups:
            group_answered = sum(1 for r in group.rows if r["answer_available"])
            toc_data.append([group.title, str(len(group.rows)), str(group_answered)])
        toc_data.append(["Total", str(total_questions), str(answered)])
        toc_table = RTable(toc_data, colWidths=[doc.width * 0.6, doc.width * 0.2, doc.width * 0.2])
        toc_table.setStyle(
            TableStyle(
                [
                    ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
                    ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
                    ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                    ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#bbbbbb")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]
            )
        )
        story.append(toc_table)
        story.append(PageBreak())

    story.append(Paragraph("Questions", h2))

    for group in groups:
        story.append(Paragraph(_escape(group.title), h2))
        if not options.answer_key_only:
            for index, row in enumerate(group.rows, start=1):
                story.extend(_question_flow(store, row, index, options, qstyle, body_small, label))
        story.append(Spacer(1, 6))

    if options.with_solutions or options.answer_key_only:
        story.append(PageBreak())
        story.append(Paragraph("Answer key", h2))
        for group in groups:
            story.append(Paragraph(_escape(group.title), h2))
            rows = []
            for index, row in enumerate(group.rows, start=1):
                correct = _correct_label(store, row)
                if not correct:
                    continue
                rows.append([str(index), correct, (row["question_text"] or "")[:80]])
            if not rows:
                continue
            table = RTable(
                [["#", "Answer", "Question"]]
                + [[str(r[0]), r[1], Paragraph(_escape(r[2]), body_small)] for r in rows],
                colWidths=[doc.width * 0.08, doc.width * 0.12, doc.width * 0.8],
            )
            table.setStyle(
                TableStyle(
                    [
                        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.5),
                        ("FONT", (0, 1), (-1, -1), "Helvetica", 8),
                        ("ALIGN", (0, 0), (0, -1), "RIGHT"),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#bbbbbb")),
                        ("TOPPADDING", (0, 0), (-1, -1), 2),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                    ]
                )
            )
            story.append(table)
            story.append(Spacer(1, 6))

    doc.build(story)
    return out_path


def _question_flow(
    store: Store,
    row: Any,
    index: int,
    options: PdfExportOptions,
    qstyle: Any,
    body_small: Any,
    label: Any,
) -> list[Any]:
    from reportlab.platypus import Paragraph, Spacer

    story: list[Any] = []
    blocks: list[Any] = []

    meta = []
    if row["exam_label"]:
        meta.append(str(row["exam_label"]))
    if row["kind"]:
        meta.append(str(row["kind"]).upper())
    if row["language"]:
        meta.append(str(row["language"]))

    header = f"[{index}]"
    if meta:
        header += "  " + " · ".join(meta)
    blocks.append(Paragraph(_escape(header), label))
    blocks.append(Paragraph(_escape(row["question_text"] or ""), qstyle))
    if row["instructions"]:
        blocks.append(Paragraph(_escape(row["instructions"]), body_small))

    if not options.questions_only:
        for option in store.options(row["id"]):
            text = option["text"] or ""
            if not text:
                continue
            blocks.append(
                Paragraph(
                    f"({_escape(option['label'] or LETTERS[option['ord']])}) {_escape(text)}",
                    body_small,
                )
            )

    if options.with_solutions and not options.questions_only:
        solution = row["solution_text"]
        feedback = _solution_feedback(store, row)
        if solution:
            blocks.append(Paragraph(f"<b>Solution:</b> {_escape(solution)}", body_small))
        elif feedback:
            blocks.append(Paragraph(f"<b>Note:</b> {_escape(feedback)}", body_small))

    from reportlab.platypus import KeepTogether

    story.append(KeepTogether(blocks))
    story.append(Spacer(1, 4))
    return story


def _solution_feedback(store: Store, row: Any) -> str | None:
    correct_option = _correct_option(store, row)
    if correct_option is None:
        return None
    return correct_option["feedback"]


def _correct_option(store: Store, row: Any):
    options = store.options(row["id"])
    for option in options:
        if option["is_correct"]:
            return option
    if row["answer_correct_option"] is not None:
        wanted = str(row["answer_correct_option"])
        for option in options:
            if str(option["ord"]) == wanted or (option["label"] or "") == wanted:
                return option
    return None


def _correct_label(store: Store, row: Any) -> str:
    option = _correct_option(store, row)
    if option is not None:
        letter = option["label"] or LETTERS[option["ord"]]
        return f"{letter}. {(option['text'] or '')[:60]}"
    if row["answer_correct_option"]:
        return str(row["answer_correct_option"])
    return ""


def _course_title(store: Store) -> str:
    rows = store.courses()
    if rows:
        return str(rows[0]["title"] or rows[0]["slug"] or "KnowledgeGate course")
    return "KnowledgeGate course"


def _subtitle(store: Store, options: PdfExportOptions) -> str:
    rows = store.courses()
    parts: list[str] = []
    if rows:
        course = rows[0]
        parts.append(f"{course['pyq_count'] or 0} PYQ + {course['practice_count'] or 0} practice questions")
    parts.append("collections: " + ", ".join(options.kinds))
    if options.scope != "course" and options.scope_slug:
        parts.append(f"scope: {options.scope} '{options.scope_slug}'")
    return " | ".join(parts)

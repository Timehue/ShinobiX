#!/usr/bin/env python3
"""Render extracted story JSON into a readable, fine-tuning-ready PDF.
Invoked by scripts/gen-story-pdf.mjs. Needs reportlab (`pip install reportlab`).

Usage: python scripts/_story-pdf-build.py <story-export.json> <out.pdf>
"""
import json, sys, html, os, glob
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                Table, TableStyle, HRFlowable, KeepTogether, Image)
from reportlab.lib.enums import TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.fonts import addMapping

# A Unicode TTF family so decorative glyphs (middot, em dash, arrows, bullet,
# smart quotes) render instead of tofu. Prefer Arial (Windows); fall back to
# reportlab's bundled Vera, then the base Helvetica if all else fails.
def _register_fonts():
    candidates = [
        ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf",
         "C:/Windows/Fonts/ariali.ttf", "C:/Windows/Fonts/arialbi.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf"),
    ]
    import reportlab
    vera = os.path.join(os.path.dirname(reportlab.__file__), "fonts")
    candidates.append((f"{vera}/Vera.ttf", f"{vera}/VeraBd.ttf", f"{vera}/VeraIt.ttf", f"{vera}/VeraBI.ttf"))
    for reg, bold, ital, boldital in candidates:
        if all(os.path.exists(p) for p in (reg, bold, ital, boldital)):
            pdfmetrics.registerFont(TTFont("Body", reg))
            pdfmetrics.registerFont(TTFont("Body-Bold", bold))
            pdfmetrics.registerFont(TTFont("Body-Italic", ital))
            pdfmetrics.registerFont(TTFont("Body-BoldItalic", boldital))
            for i, (b, it, nm) in enumerate([(0,0,"Body"),(1,0,"Body-Bold"),(0,1,"Body-Italic"),(1,1,"Body-BoldItalic")]):
                addMapping("Body", b, it, nm)
            return True
    # Last resort: map Body -> Helvetica (some glyphs may not render).
    for b, it, nm in [(0,0,"Helvetica"),(1,0,"Helvetica-Bold"),(0,1,"Helvetica-Oblique"),(1,1,"Helvetica-BoldOblique")]:
        addMapping("Body", b, it, nm)
    for alias, real in [("Body","Helvetica"),("Body-Bold","Helvetica-Bold"),("Body-Italic","Helvetica-Oblique"),("Body-BoldItalic","Helvetica-BoldOblique")]:
        pdfmetrics.registerFontFamily(alias)
    return False

_register_fonts()

in_path, out_path = sys.argv[1], sys.argv[2]
data = json.load(open(in_path, encoding="utf-8"))

INK, MUTED, ACCENT = colors.HexColor("#1a1a2e"), colors.HexColor("#5b5b78"), colors.HexColor("#6d3bd4")
GOOD, NEUTRAL, BAD = colors.HexColor("#1a7a4a"), colors.HexColor("#8a6d1a"), colors.HexColor("#9a2a2a")
SCENEBG, RULE = colors.HexColor("#f3f1fb"), colors.HexColor("#d8d4ec")

def esc(s): return html.escape(str(s), quote=False)

S = {
 "cover_title": ParagraphStyle("cover_title", fontName="Body-Bold", fontSize=30, leading=36, textColor=ACCENT, spaceAfter=6, alignment=TA_CENTER),
 "cover_sub":   ParagraphStyle("cover_sub", fontName="Body", fontSize=12, leading=18, textColor=MUTED, alignment=TA_CENTER),
 "village":     ParagraphStyle("village", fontName="Body-Bold", fontSize=22, leading=26, textColor=ACCENT, spaceBefore=6, spaceAfter=2),
 "section":     ParagraphStyle("section", fontName="Body-Bold", fontSize=15, leading=19, textColor=INK, spaceBefore=14, spaceAfter=6),
 "scene_title": ParagraphStyle("scene_title", fontName="Body-Bold", fontSize=13, leading=16, textColor=INK, spaceBefore=10, spaceAfter=1),
 "locator":     ParagraphStyle("locator", fontName="Courier", fontSize=7.5, leading=10, textColor=MUTED, spaceAfter=4),
 "page_head":   ParagraphStyle("page_head", fontName="Body-BoldItalic", fontSize=9.5, leading=13, textColor=ACCENT, spaceBefore=7, spaceAfter=2),
 "caption":     ParagraphStyle("caption", fontName="Body-Italic", fontSize=8.5, leading=11, textColor=MUTED, spaceAfter=3),
 "line":        ParagraphStyle("line", fontName="Body", fontSize=10, leading=14, textColor=INK, spaceAfter=2, leftIndent=10),
 "choice":      ParagraphStyle("choice", fontName="Body", fontSize=9.5, leading=13, textColor=INK, spaceAfter=2, leftIndent=14),
 "concl":       ParagraphStyle("concl", fontName="Body-Italic", fontSize=9, leading=12, textColor=MUTED, spaceAfter=4, leftIndent=26),
 "toc":         ParagraphStyle("toc", fontName="Body", fontSize=10, leading=16, textColor=INK),
 "note":        ParagraphStyle("note", fontName="Body", fontSize=10, leading=15, textColor=INK),
 "cast_cap":    ParagraphStyle("cast_cap", fontName="Body", fontSize=7, leading=8.5, textColor=MUTED, alignment=TA_CENTER),
}
LANE_COLOR = {"good": GOOD, "neutral": NEUTRAL, "bad": BAD}
flow = []

def hr(color=RULE, w=0.6, sb=2, sa=6):
    flow.extend([Spacer(1, sb), HRFlowable(width="100%", thickness=w, color=color), Spacer(1, sa)])

def scene_caption_box(text):
    if not text: return
    t = Table([[Paragraph("<i>" + esc(text) + "</i>", S["caption"])]], colWidths=[6.5*inch])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),SCENEBG),("BOX",(0,0),(-1,-1),0.4,RULE),
                           ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
                           ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4)]))
    flow.extend([t, Spacer(1,3)])

def scaled_image(rec, disp_w, max_h):
    """An Image scaled to disp_w (capped at max_h), preserving aspect."""
    w, h = float(rec["w"]), float(rec["h"])
    dw, dh = disp_w, disp_w * (h / w)
    if dh > max_h:
        dh, dw = max_h, max_h * (w / h)
    return Image(rec["file"], width=dw, height=dh)

def cast_strip(cast):
    """A wrapping row of speaker portraits with name captions."""
    per_row = 6
    for start in range(0, len(cast), per_row):
        chunk = cast[start:start+per_row]
        imgs = [scaled_image(c, 0.82*inch, 0.82*inch) for c in chunk]
        caps = [Paragraph(esc(c["name"]), S["cast_cap"]) for c in chunk]
        t = Table([imgs, caps], colWidths=[1.02*inch]*len(chunk))
        t.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),("VALIGN",(0,0),(-1,-1),"TOP"),
                               ("TOPPADDING",(0,0),(-1,-1),1),("BOTTOMPADDING",(0,0),(-1,0),1)]))
        flow.append(t)
    flow.append(Spacer(1,3))

def render_scene(sc, header):
    blk = [Paragraph(esc(header), S["scene_title"])]
    if sc["kind"] == "chapter":
        extra = f' &nbsp;·&nbsp; Boss: {esc(sc["boss"])} &nbsp;·&nbsp; +{sc["rewardXp"]} XP / {sc["rewardRyo"]} ryo'
        if sc["isFinale"]: extra += f' &nbsp;·&nbsp; FINALE → title "{esc(sc["liberatorTitle"])}"'
    elif sc["kind"] == "road":
        extra = f' &nbsp;·&nbsp; NPC: {esc(sc["npcName"])} ({esc(sc["npcArchetype"])})' + (" · POST-FINALE" if sc["postFinale"] else "")
    elif sc["kind"] == "epilogue":
        extra = f' &nbsp;·&nbsp; plays once after winning the finale on the <b>{esc(sc["lane"])}</b> choice'
        extra += f' &nbsp;·&nbsp; <font color="#0a5a8a">[only with: {esc(sc["requireTrait"])}]</font>' if sc["requireTrait"] else ' &nbsp;·&nbsp; (base ending)'
    else:
        extra = " &nbsp;·&nbsp; interlude (no fight; choice is the payoff)"
    blk.append(Paragraph("EDIT: " + esc(sc["editLocator"]) + extra, S["locator"]))
    if sc.get("sceneImage"):
        blk.extend([Spacer(1,3), scaled_image(sc["sceneImage"], 5.4*inch, 3.5*inch)])
    flow.append(KeepTogether(blk))
    if sc.get("cast"):
        cast_strip(sc["cast"])
    for pg in sc["pages"]:
        flow.append(Paragraph(f'Page {pg["index"]+1} &nbsp;— &nbsp;{esc(pg["title"])}', S["page_head"]))
        scene_caption_box(pg["scene"])
        for ln in pg["lines"]:
            sp, tx = esc(ln["speaker"]), esc(ln["text"])
            flow.append(Paragraph(f'<i>{tx}</i>' if sp.lower() in ("narrator","") else f'<b>{sp}:</b> {tx}', S["line"]))
        lanes = [c for c in pg["choices"] if c["isLane"]]
        for c in [c for c in pg["choices"] if not c["isLane"]]:
            gate = f' <font color="#0a5a8a">[only if: {esc(c["requireTrait"])}]</font>' if c["requireTrait"] else ""
            if c.get("forbidTrait"):
                gate += f' <font color="#8a4a0a">[hidden once: {esc(c["forbidTrait"])}]</font>'
            grant = f' <font color="#1a7a4a">[+{esc(c["trait"])}]</font>' if (c["trait"] and c["requireTrait"]) else ""
            dest = f' <font color="#5b5b78">→ page “{esc(c["targetTitle"])}”</font>' if c["targetTitle"] else ""
            flow.append(Paragraph(f'» <b>{esc(c["text"])}</b>{gate}{grant}{dest}', S["choice"]))
        if lanes:
            flow.append(Spacer(1,2))
            flow.append(Paragraph('<font color="#6d3bd4"><b>DECISION</b> (recorded; leads to the fight for chapters):</font>', S["choice"]))
            for c in lanes:
                col = LANE_COLOR.get((c["lane"] or "").lower(), ACCENT)
                tag = f'<font color="#{col.hexval()[2:]}"><b>[{(c["lane"] or "path").upper()}]</b></font> '
                flow.append(Paragraph(f'• {tag}<b>{esc(c["text"])}</b> <font color="#5b5b78">→ trait <font name="Body-Bold">{esc(c["trait"])}</font></font>', S["choice"]))
                if c["conclusion"]: flow.append(Paragraph(esc(c["conclusion"]), S["concl"]))
    hr()

# Cover
flow.append(Spacer(1, 1.6*inch))
flow.append(Paragraph("ShinobiX — The Story", S["cover_title"]))
flow.append(Paragraph("Full script export for review and fine-tuning", S["cover_sub"]))
flow.append(Spacer(1, 0.3*inch))
tot_ch = sum(len(v["chapters"]) for v in data["villages"])
tot_il = sum(len(v["interludes"]) for v in data["villages"])
cover_bits = [f'{len(data["villages"])} village' + ("s" if len(data["villages"]) != 1 else ""),
              f'{tot_ch} chapters', f'{tot_il} interludes']
if data["roadEvents"]: cover_bits.append(f'{len(data["roadEvents"])} wandering road events')
flow.append(Paragraph(" &nbsp;·&nbsp; ".join(cover_bits), S["cover_sub"]))
flow.append(Spacer(1, 0.5*inch))
flow.append(Paragraph(
    "<b>How to read this</b><br/>"
    "Each scene shows its pages in order. <b>Bold name:</b> speaker. <i>Italic:</i> narration or scene caption.<br/>"
    "» a branch choice inside a scene (steers the conversation; the arrow shows where it goes).<br/>"
    "[only if: trait] a choice that appears only if the player earned that trait earlier (reactive callback).<br/>"
    "• DECISION: the recorded good / neutral / bad choice, its trait, and its aftermath line.<br/>"
    "The grey <font name='Courier'>EDIT:</font> line under each title is exactly where to change that scene in the source files.", S["note"]))
flow.append(PageBreak())

# TOC
flow.append(Paragraph("Contents", S["section"]))
for v in data["villages"]:
    flow.append(Paragraph(f'<b>{esc(v["village"])}</b>', S["toc"]))
    flow.append(Paragraph('<font size=8 color="#5b5b78">Chapters: ' + " · ".join(f'L{c["level"]} {esc(c["title"])}' for c in v["chapters"]) + '</font>', S["toc"]))
    flow.append(Paragraph('<font size=8 color="#5b5b78">Interludes: ' + " · ".join(f'L{i["level"]} {esc(i["title"])}' for i in v["interludes"]) + '</font>', S["toc"]))
    if v.get("epilogues"):
        flow.append(Paragraph('<font size=8 color="#5b5b78">Endings: ' + " · ".join(f'{esc(e["lane"])} {esc(e["title"])}' for e in v["epilogues"]) + '</font>', S["toc"]))
    flow.append(Spacer(1,4))
if data["roadEvents"]:
    flow.append(Paragraph('<b>Wandering Road Events</b> (cross-village, found on the world map)', S["toc"]))
    flow.append(Paragraph('<font size=8 color="#5b5b78">' + " · ".join(f'L{e["level"]} {esc(e["title"])}' for e in data["roadEvents"]) + '</font>', S["toc"]))
flow.append(PageBreak())

# Villages
for v in data["villages"]:
    flow.append(Paragraph(esc(v["village"]), S["village"]))
    hr(ACCENT, 1.4, 1, 8)
    merged = [("chapter", c) for c in v["chapters"]] + [("interlude", i) for i in v["interludes"]]
    merged.sort(key=lambda t: (t[1]["level"], 0 if t[0]=="chapter" else 1))
    flow.append(Paragraph("Main arc (chapters) and interludes, in play order:", S["caption"]))
    for kind, sc in merged:
        header = (f'CHAPTER · Level {sc["level"]} · {sc["title"]}' if kind=="chapter"
                  else f'Interlude · Level {sc["level"]} · {sc["title"]}')
        render_scene(sc, header)
    for sc in v.get("epilogues", []):
        render_scene(sc, f'ENDING · {sc["lane"]} · {sc["title"]}')
    flow.append(PageBreak())

# Road events (omitted when a single village was selected)
if data["roadEvents"]:
    flow.append(Paragraph("Wandering Road Events", S["village"]))
    hr(ACCENT, 1.4, 1, 8)
    flow.append(Paragraph("Cross-village mini-stories delivered by road NPCs on the world map. They react to the player's reputation and branch back into the main arcs.", S["caption"]))
    for e in data["roadEvents"]:
        render_scene(e, f'ROAD · Level {e["level"]} · {e["title"]}')

def footer(canvas, doc):
    canvas.saveState(); canvas.setFont("Body", 7.5); canvas.setFillColor(MUTED)
    canvas.drawRightString(letter[0]-0.75*inch, 0.5*inch, f'ShinobiX story export · page {doc.page}')
    canvas.restoreState()

SimpleDocTemplate(out_path, pagesize=letter, leftMargin=0.85*inch, rightMargin=0.85*inch,
                  topMargin=0.7*inch, bottomMargin=0.7*inch, title="ShinobiX — The Story",
                  author="ShinobiX").build(flow, onFirstPage=footer, onLaterPages=footer)
print("wrote", out_path)

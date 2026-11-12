"""Rebuild the fixed admission PDF; runtime serving does not need Python."""
import argparse
import json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[1]
# PDF uses points: total increase of 5 CSS pixels equals 3.75 points.
FONT_INCREASE = 5 * 72 / 96
parser = argparse.ArgumentParser()
parser.add_argument('--font', default='C:/Windows/Fonts/simsun.ttc')
args = parser.parse_args()
pdfmetrics.registerFont(TTFont('Chinese', args.font, subfontIndex=0))
source = json.loads((ROOT / 'server/documents/admission-flow.json').read_text(encoding='utf-8'))
output = ROOT / 'server/documents/admission-flow.pdf'
c = canvas.Canvas(str(output), pagesize=(595.28, 841.89))
c.setTitle(source['title'])
c.setAuthor('康复科')
c.setFillColor(HexColor('#173e61'))
c.setFont('Chinese', 22 + FONT_INCREASE)
c.drawCentredString(297.64, 796, source['title'])
left = ParagraphStyle('step', fontName='Chinese', fontSize=11 + FONT_INCREASE, leading=21, wordWrap='CJK', textColor=HexColor('#173e61'))
right = ParagraphStyle('description', fontName='Chinese', fontSize=10.5 + FONT_INCREASE, leading=20, wordWrap='CJK', textColor=HexColor('#273444'))
c.setFillColor(HexColor('#eaf2f9'))
c.roundRect(32, 752, 531, 26, 5, fill=1, stroke=0)
c.setFillColor(HexColor('#173e61'))
c.setFont('Chinese', 11 + FONT_INCREASE)
c.drawString(49, 760, '流程')
c.drawString(216, 760, '说明')
y = 744
for index, step in enumerate(source['steps'], 1):
    a = Paragraph(f'{index:02d}　{step["title"]}', left)
    b = Paragraph(step['description'], right)
    _, ah = a.wrap(164, 700)
    _, bh = b.wrap(327, 700)
    height = max(ah, bh, 20) + 12
    if y - height < 35:
        raise ValueError('Content exceeds one page; adjust layout before publishing')
    if index % 2 == 0:
        c.setFillColor(HexColor('#f5f8fb'))
        c.rect(32, y-height, 531, height, fill=1, stroke=0)
    a.drawOn(c, 42, y-6-ah)
    b.drawOn(c, 216, y-6-bh)
    y -= height
c.setFont('Chinese', 9 + FONT_INCREASE)
c.setFillColor(HexColor('#718096'))
c.drawCentredString(297.64, 20, '康复科入院流程  /  1')
c.save()
print(output)

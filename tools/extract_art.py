"""Extract card art from the official One King One Crown print-and-play PDF.

Usage:  python -I tools/extract_art.py <Print_At_Home_OKOC.pdf> <out_dir>

The PDF is free from https://onecrown.store/ (CC BY-NC-SA 4.0).
Requires: pip install pypdfium2 pillow
Pages are US Letter with a 3x3 grid of 2.5x3.5in cards.
"""
import sys
import os

import pypdfium2 as pdfium

SCALE = 3  # 216 dpi
# Card grid in PDF points (612 x 792 page): x 36..576, y 18..774 => 180 x 252 pt cards
GRID_X0, GRID_Y0, CARD_W, CARD_H = 36, 18, 180, 252
INSET = 3  # pt, trims the black cut lines

# page (1-based) -> card ids in reading order (None = skip)
PAGES = {
    5: ["character-king", "character-noble"] + [None] * 7,
    6: ["back-character"] + [None] * 8,
    7: ["actors", None, None, "allies", None, None, "bad-blood", None, None],
    8: ["back-noble"] + [None] * 8,
    9: ["beggars-blessing", None, None, "betrayal", None, None, None, "betray-the-king", None],
    11: ["council-meeting", None, None, "divine-right", "grudge", None, "helping-hand", None, None],
    13: ["hindsight", None, "icarus", None, "indebted", None, "isolation", None, None],
    15: ["king-maker", None, "knight", None, "loyalty", None, None, "meat-for-meat", None],
    17: [None, None, "peoples-champion", "royal-bomb", "scout", None, "shadow-deal", None, None],
    19: [None, None, "sub-rosa", None, None, None, None, "subsidies", None],
    21: [None, "suppress-rebellion", None, "tithe", None, "unprotected", None, "wrath", None],
    23: [None, None, "black-plague", "eye-for-an-eye", "bend-the-knee", None, "king-helping-hand", "king-knight", "anchor"],
    24: ["back-king"] + [None] * 8,
    25: [None, "loyal-dog", None, None, "mad-king", "debt-collector", None, "royal-parrot", None],
    27: ["shifting-tides", "snakes", "king-sub-rosa", None, "scapegoat", "kings-eye", None, "we-ride-together", None],
}
# Non-card art: (page, name, (x0, y0, x1, y1) in points)
EXTRA = [
    (3, "round-tracker", (118, 19, 494, 287)),
    (4, "hourglass", (118, 19, 494, 287)),
]


def main(pdf_path, out_dir):
    os.makedirs(os.path.join(out_dir, "cards"), exist_ok=True)
    pdf = pdfium.PdfDocument(pdf_path)
    for page_no, ids in PAGES.items():
        img = pdf[page_no - 1].render(scale=SCALE).to_pil().convert("L")
        for i, cid in enumerate(ids):
            if not cid:
                continue
            col, row = i % 3, i // 3
            x0 = (GRID_X0 + col * CARD_W + INSET) * SCALE
            y0 = (GRID_Y0 + row * CARD_H + INSET) * SCALE
            x1 = (GRID_X0 + (col + 1) * CARD_W - INSET) * SCALE
            y1 = (GRID_Y0 + (row + 1) * CARD_H - INSET) * SCALE
            sub = "" if cid.startswith(("back-", "character-")) else "cards"
            img.crop((x0, y0, x1, y1)).save(os.path.join(out_dir, sub, cid + ".png"), optimize=True)
    for page_no, name, box in EXTRA:
        img = pdf[page_no - 1].render(scale=SCALE).to_pil().convert("L")
        img.crop(tuple(v * SCALE for v in box)).save(os.path.join(out_dir, name + ".png"), optimize=True)
    print("done")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

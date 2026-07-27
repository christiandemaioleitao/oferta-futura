# -*- coding: utf-8 -*-
"""Converte o KMZ de bairros de Goiânia em data/bairros_of.js com coloração
de grafo: bairros que fazem divisa recebem cores diferentes (greedy Welsh-Powell).
Uso único — bairros não mudam; rodar de novo só se o KMZ for atualizado.
"""
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from shapely.geometry import Polygon

BASE = Path(__file__).resolve().parent.parent
KMZ = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "fontes" / "bairros_goiania.kmz"
OUT = BASE / "data" / "bairros_of.js"

# paleta pastel legível sobre mapa claro e satélite
PALETTE = ["#3A5AA0", "#E30A12", "#1B9E77", "#E6AB02", "#7570B3", "#D95F02", "#66A61E", "#A6761D"]

NS = {"k": "http://www.opengis.net/kml/2.2"}


def load_kml(path: Path) -> str:
    if path.suffix.lower() == ".kml":
        return path.read_text(encoding="utf-8")
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".kml"))
        return z.read(name).decode("utf-8")


def parse_coords(text: str):
    pts = []
    for tok in (text or "").split():
        parts = tok.split(",")
        if len(parts) >= 2:
            pts.append((float(parts[0]), float(parts[1])))  # lng, lat
    return pts


def main():
    kml = load_kml(KMZ)
    # alguns KMLs vêm sem namespace declarado de forma uniforme
    kml = re.sub(r"<kml[^>]*>", "<kml xmlns=\"http://www.opengis.net/kml/2.2\">", kml, count=1)
    root = ET.fromstring(kml)
    feats = []
    for pm in root.iter("{http://www.opengis.net/kml/2.2}Placemark"):
        name_el = pm.find("k:name", NS)
        name = (name_el.text or "").strip() if name_el is not None else ""
        for poly in pm.iter("{http://www.opengis.net/kml/2.2}Polygon"):
            outer = poly.find(".//k:outerBoundaryIs//k:coordinates", NS)
            if outer is None:
                continue
            ring = parse_coords(outer.text)
            if len(ring) >= 4:
                feats.append({"name": name, "ring": ring})
    if not feats:
        raise SystemExit("nenhum polígono encontrado no KMZ")

    polys = [Polygon(f["ring"]).buffer(0) for f in feats]  # buffer(0) corrige auto-interseções
    n = len(feats)

    # adjacência: divisa = interseção com buffer pequeno (~20 m em graus)
    eps = 0.0002
    adj = [set() for _ in range(n)]
    for i in range(n):
        bi = polys[i].buffer(eps)
        for j in range(i + 1, n):
            if bi.intersects(polys[j]):
                adj[i].add(j)
                adj[j].add(i)

    # Welsh-Powell: ordena por grau desc, cor mais baixa livre entre vizinhos
    order = sorted(range(n), key=lambda i: -len(adj[i]))
    color = [-1] * n
    for i in order:
        used = {color[j] for j in adj[i] if color[j] >= 0}
        c = 0
        while c in used:
            c += 1
        color[i] = c
    ncolors = max(color) + 1
    print(f"{n} bairros, {sum(len(a) for a in adj)//2} divisas, {ncolors} cores")

    out_feats = []
    for i, f in enumerate(feats):
        # simplifica levemente p/ reduzir peso (tolerância ~5 m)
        simp = polys[i].simplify(0.00005, preserve_topology=True)
        ext = list(simp.exterior.coords) if simp.geom_type == "Polygon" else f["ring"]
        latlngs = [[round(lat, 6), round(lng, 6)] for lng, lat in ext]
        out_feats.append({"name": f["name"], "color": PALETTE[color[i] % len(PALETTE)], "coords": latlngs})

    OUT.write_text(
        "window.OF_BAIRROS=" + json.dumps({"features": out_feats}, ensure_ascii=False, separators=(",", ":")) + ";",
        encoding="utf-8",
    )
    print(f"gravado {OUT} ({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()

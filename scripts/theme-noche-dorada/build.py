"""Genera los sprites del tema "Noche Dorada" a partir del tema clásico.

Idea: no se redibuja nada a mano. Se recolorean los sprites originales para que
todos los marcos, botones y posiciones encajen píxel a píxel con el cliente:

  * Azules claros / cielo  -> azul medianoche e índigo (paneles oscuros).
  * Reflejos casi blancos de los marcos azules -> dorado (ribetes y brillos).
  * Azules muy saturados (equipo B, iconos) -> se mantienen azules, solo más
    profundos, para no perder la diferencia entre equipos.
  * Zonas protegidas (rangos, iconos de objetos, textos WIN/LOSE...) intactas.

Uso (desde la raíz del repo, con Python 3 + numpy + opencv-python):
    python3 scripts/theme-noche-dorada/build.py

Escribe en src/web/public_html/data/images/themes/nochedorada/.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
THEMES = ROOT / "src/web/public_html/data/images/themes"
OUT = THEMES / "nochedorada"

# Paleta (BGR)
GOLD = np.array([78, 193, 242], np.float32)        # #F2C14E
GOLD_DEEP = np.array([42, 144, 200], np.float32)   # #C8902A
NIGHT = np.array([36, 15, 10], np.float32)         # #0A0F24

# Rectángulos (x0, y0, x1, y1) del atlas stuff_HD (2000x3000) que NO se tocan
ATLAS_KEEP = [
    (1750, 1700, 2000, 2290),   # rangos, iconos de stats, objetos, VIP...
    (1000, 340, 1190, 505),     # textos de estado de sala: Waiting / Playing / Full
    (1240, 2700, 1500, 3000),   # letrero WIN / LOSE
    (1600, 2460, 2000, 2700),   # cajas de regalo / bonus
    (735, 2625, 1240, 2792),    # números de daño (rojo/azul/verde) y dígitos pequeños del HUD
]


# Rampa nocturna por luminancia (L de Lab normalizada 0..1 -> BGR)
RAMP_X = [0.0, 0.30, 0.60, 0.82, 1.0]
RAMP_C = np.array([
    [24, 9, 6],      # #06091A
    [53, 23, 17],    # #111735
    [85, 38, 29],    # #1D2655
    [120, 56, 43],   # #2B3878
    [160, 80, 62],   # #3E50A0
], np.float32)


def ramp(lum: np.ndarray) -> np.ndarray:
    return np.stack([np.interp(lum, RAMP_X, RAMP_C[:, c]) for c in range(3)], -1).astype(np.float32)


def recolor(bgr: np.ndarray, neutral: bool = False, gold: float = 1.0) -> np.ndarray:
    """Recolorea BGR uint8 hacia la paleta nocturna.

    neutral=True también lleva a la noche los grises/blancos (fondos de pantalla);
    en el atlas va a False para no oscurecer recuadros blancos (cartas de la tienda,
    vista previa del avatar) sobre los que el juego escribe texto negro.
    """
    img = bgr.astype(np.float32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s = hsv[..., 0], hsv[..., 1]
    L = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)[..., 0].astype(np.float32)

    hue_w = np.clip(1 - np.abs(h - 108) / 28, 0, 1) ** 0.6
    blue = hue_w * np.clip((s - 6) / 16, 0, 1)
    w = np.maximum(blue, np.clip(1 - s / 45, 0, 1)) if neutral else blue

    # Destino: rampa nocturna; los azules muy saturados (equipo B, iconos) conservan
    # su color, solo un poco más profundo, para no perder significado.
    lum = L / 255.0
    night = ramp(lum ** 1.5 if neutral else lum)   # fondos: más profundidad (gamma)
    keep = np.clip((s - 125) / 45, 0, 1)[..., None]
    deep = img * 0.82
    target = night * (1 - keep) + deep * keep
    out = img * (1 - w[..., None]) + target * w[..., None]

    # Ribetes dorados: solo líneas finas más claras que su entorno (reflejos de marcos).
    light = np.clip((L - 175) / 50, 0, 1)
    thin = np.clip((L - cv2.GaussianBlur(L, (0, 0), 2.2)) / 12, 0, 1)
    gw = cv2.GaussianBlur(light * thin * w, (0, 0), 0.6) * gold
    gw = np.clip(gw * 1.3, 0, 1)[..., None]
    gold_px = GOLD_DEEP + (GOLD - GOLD_DEEP) * (L / 255.0)[..., None]
    out = out * (1 - 0.92 * gw) + gold_px * (0.92 * gw)
    return np.clip(out, 0, 255).astype(np.uint8)


# Zonas del atlas que solo se tiñen (sin rampa nocturna) para conservar el contraste
# entre texto y fondo: pestañas All / Friends / Guild / Items.
ATLAS_SOFT = [
    (1570, 0, 2000, 186),
    (1570, 186, 1700, 365),
    (0, 2630, 285, 2785),       # botones de disparo 1 / 2 / SS del HUD
]


def tint(bgr: np.ndarray) -> np.ndarray:
    """Tinte suave: azul cielo -> índigo, algo más oscuro, mismo contraste relativo."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    blue = np.clip(1 - np.abs(hsv[..., 0] - 108) / 28, 0, 1) * np.clip((hsv[..., 1] - 6) / 16, 0, 1)
    hsv[..., 0] = np.clip(hsv[..., 0] + 9 * blue, 0, 179)
    hsv[..., 1] = np.clip(hsv[..., 1] * (1 + 0.15 * blue), 0, 255)
    hsv[..., 2] = hsv[..., 2] * (1 - 0.30 * blue)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


def process(src: Path, dst: Path, keep=(), soft=(), **kw) -> None:
    im = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise FileNotFoundError(src)
    alpha = im[..., 3] if im.ndim == 3 and im.shape[2] == 4 else None
    bgr = im[..., :3] if alpha is not None else im
    out = recolor(bgr, **kw)
    for x0, y0, x1, y1 in soft:
        out[y0:y1, x0:x1] = tint(np.ascontiguousarray(bgr[y0:y1, x0:x1]))
    for x0, y0, x1, y1 in keep:
        out[y0:y1, x0:x1] = bgr[y0:y1, x0:x1]
    if alpha is not None:
        out = np.dstack([out, alpha])
    dst.parent.mkdir(parents=True, exist_ok=True)
    params = [cv2.IMWRITE_JPEG_QUALITY, 88] if dst.suffix == ".jpg" else [cv2.IMWRITE_PNG_COMPRESSION, 9]
    cv2.imwrite(str(dst), out, params)
    print(f"  {src.relative_to(THEMES.parent)} -> {dst.relative_to(THEMES.parent)}  {out.shape[1]}x{out.shape[0]}")


def page_background(dst: Path, w: int = 1920, h: int = 1080) -> None:
    """Fondo de página alrededor del juego: noche índigo con resplandor dorado y estrellas."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = yy / h
    top = np.array([46, 20, 12], np.float32)      # #0C142E
    bottom = np.array([70, 30, 22], np.float32)   # #161E46
    img = top + (bottom - top) * t[..., None]
    # resplandor dorado en el horizonte
    d = np.sqrt(((xx - w / 2) / (w * 0.55)) ** 2 + ((yy - h * 1.05) / (h * 0.45)) ** 2)
    glow = np.clip(1 - d, 0, 1) ** 2.2
    img += glow[..., None] * np.array([40, 120, 170], np.float32)
    # viñeta
    vig = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    img *= (1 - 0.35 * np.clip(vig - 0.5, 0, 1))[..., None]
    # estrellas deterministas
    rng = np.random.default_rng(7)
    for _ in range(380):
        x, y = int(rng.uniform(0, w)), int(rng.uniform(0, h * 0.75))
        b = rng.uniform(0.25, 1.0) * (1 - y / (h * 0.9))
        r = 1 if rng.random() < 0.85 else 2
        col = (np.array([210, 225, 255]) if rng.random() < 0.8 else np.array([120, 200, 255])) * b
        cv2.circle(img, (x, y), r, col.tolist(), -1, cv2.LINE_AA)
    img = cv2.GaussianBlur(img, (0, 0), 0.6)
    cv2.imwrite(str(dst), np.clip(img, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])
    print(f"  (generado) -> {dst.relative_to(THEMES)}  {w}x{h}")


def main() -> None:
    print("Tema Noche Dorada:")
    process(THEMES / "classic/lobby_bg.png", OUT / "lobby_bg.png", neutral=True)
    process(THEMES / "classic/room_bg.png", OUT / "room_bg.png", neutral=True)
    process(THEMES / "classic/shop_bg.png", OUT / "shop_bg.png", neutral=True)
    process(THEMES / "classicHD/stuff_HD1.png", OUT / "stuff_HD.png", keep=ATLAS_KEEP, soft=ATLAS_SOFT)
    # Tarjetas del selector de servidor: solo las dos primeras (online / offline);
    # las de eventos (Halloween, Navidad...) se dejan como están.
    process(THEMES.parent / "servers.png", OUT / "servers.png", keep=[(0, 142, 190, 780)], neutral=True, gold=0.5)
    page_background(OUT / "bg_full.jpg")


if __name__ == "__main__":
    main()

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
ICON = Image.open(ROOT / "assets" / "icon.png").convert("RGBA")
FOREGROUND = Image.open(ROOT / "assets" / "android-icon-foreground.png").convert("RGBA")
BACKGROUND = Image.open(ROOT / "assets" / "android-icon-background.png").convert("RGBA")
MONO = Image.open(ROOT / "assets" / "android-icon-monochrome.png").convert("RGBA")

DENSITIES = {
    "mipmap-mdpi": (48, 108),
    "mipmap-hdpi": (72, 162),
    "mipmap-xhdpi": (96, 216),
    "mipmap-xxhdpi": (144, 324),
    "mipmap-xxxhdpi": (192, 432),
}


def save_webp(image: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.resize((size, size), Image.Resampling.LANCZOS).save(path, "WEBP", quality=95, lossless=True)


for folder, (launcher_size, adaptive_size) in DENSITIES.items():
    target = RES / folder
    save_webp(ICON, target / "ic_launcher.webp", launcher_size)
    save_webp(ICON, target / "ic_launcher_round.webp", launcher_size)
    save_webp(BACKGROUND, target / "ic_launcher_background.webp", adaptive_size)
    save_webp(FOREGROUND, target / "ic_launcher_foreground.webp", adaptive_size)
    save_webp(MONO, target / "ic_launcher_monochrome.webp", adaptive_size)

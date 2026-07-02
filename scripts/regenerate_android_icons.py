from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
SIZE = 1024


def centered_logo(source: Image.Image, max_size: int, background: tuple[int, int, int, int]) -> Image.Image:
    bbox = source.getbbox()
    logo = source.crop(bbox) if bbox else source.copy()
    logo.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), background)
    canvas.alpha_composite(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2))
    return canvas


SOURCE = Image.open(ROOT / "assets" / "logo.png").convert("RGBA")
ICON = centered_logo(SOURCE, 650, (255, 255, 255, 255))
FOREGROUND = centered_logo(SOURCE, 620, (0, 0, 0, 0))
BACKGROUND = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
MONO = centered_logo(SOURCE, 620, (0, 0, 0, 0))

ICON.save(ROOT / "assets" / "icon.png")
FOREGROUND.save(ROOT / "assets" / "android-icon-foreground.png")
BACKGROUND.save(ROOT / "assets" / "android-icon-background.png")
MONO.save(ROOT / "assets" / "android-icon-monochrome.png")

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

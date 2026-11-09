"""Assemble the existing mockups into a short navigation demo.

Reproduce from the repository root:
  python3 -m venv /tmp/botrelatorio-gif-env
  /tmp/botrelatorio-gif-env/bin/pip install -r docs/mockups/reproduce/requirements-demo.txt
  /tmp/botrelatorio-gif-env/bin/python docs/mockups/reproduce/build_demo.py

Requires DejaVu Sans fonts (normally /usr/share/fonts/truetype/dejavu).
Writes docs/mockups/demo-mini-app-v2.gif and docs/mockups/demo-preview-v2.png.
Source screenshots and the earlier demo-mini-app.gif stay untouched.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version

ROOT = Path(__file__).resolve().parents[1]
SIZE = (600, 1080)
BACKGROUND = '#edf3fa'
INK = '#132b48'
MUTED = '#52667d'
BLUE = '#087ef5'
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')

# Touch coordinates refer to original source pixels, not the resized screenshots.
SCENES = [
    ('entrada-telegram-v2.png', (176, 146, 657, 960),
     'Comece pelo Telegram', 'Toque em “Abrir Diário da obra”.', (422, 524), 2600),
    ('entrada-telegram-v2.png', (877, 146, 1360, 960),
     'Escolha a obra', 'Abra a HTO na lista de obras.', (1112, 454), 2500),
    ('hto-modelo-federado-v1.png', (194, 81, 693, 960),
     'Início da HTO', 'Veja o modelo completo da obra.', (446, 344), 2700),
    ('hto-modelo-federado-v1.png', (835, 81, 1340, 960),
     'Explore o modelo federado', 'Depois, toque em “HTO” para voltar.', (890, 162), 4200),
    ('hto-modelo-federado-v1.png', (194, 81, 693, 960),
     'Abra um ambiente', 'Apto. 101 selecionado · toque em “Abrir ambiente”.', (444, 908), 2500),
    ('mini-app-v2.png', (1040, 41, 1339, 503),
     'Consulte o histórico', 'Veja as fotos e toque em “Novo registro”.', (1194, 471), 2700),
    ('mini-app-v2.png', (335, 552, 620, 1008),
     'Prepare um novo registro', 'Foto, tipo e legenda · demonstração sem envio.', None, 4500),
    ('mini-app-v2.png', (687, 552, 977, 1008),
     'Acompanhe as pendências', 'Outro fluxo do mockup · toque na primeira pendência.', (835, 780), 3000),
    ('mini-app-v2.png', (1040, 552, 1339, 1008),
     'Encerrar uma pendência', 'Foto de comprovação · demonstração sem concluir.', None, 4500),
]


def font(size, bold=False):
    filename = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    return ImageFont.truetype(str(FONT_DIR / filename), size)


def centered(draw, y, text, size, color=INK, bold=False):
    selected = font(size, bold)
    # Keep captions outside the app even if future copy is slightly longer.
    while draw.textbbox((0, 0), text, font=selected)[2] > SIZE[0] - 36:
        size -= 1
        selected = font(size, bold)
    draw.text((SIZE[0] / 2, y), text, anchor='mt', font=selected, fill=color)


def scene_frame(scene, index):
    source, crop, title, caption, touch, _ = scene
    with Image.open(ROOT / source) as screenshot:
        assert 0 <= crop[0] < crop[2] <= screenshot.width
        assert 0 <= crop[1] < crop[3] <= screenshot.height
        app = screenshot.convert('RGB').crop(crop)
    scale = min(500 / app.width, 850 / app.height)
    app = app.resize((round(app.width * scale), round(app.height * scale)), Image.Resampling.LANCZOS)
    position = ((SIZE[0] - app.width) // 2, 120 + (850 - app.height) // 2)
    canvas = Image.new('RGB', SIZE, BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    centered(draw, 28, 'Demonstração do mockup', 22, bold=True)
    centered(draw, 64, 'DIÁRIO DA OBRA  /  MINI APP TELEGRAM', 12, MUTED)
    for step in range(len(SCENES)):
        x = (SIZE[0] - ((len(SCENES) - 1) * 18 + 7)) / 2 + step * 18
        draw.ellipse((x, 91, x + 7, 98), fill=BLUE if step == index else '#c6d4e5')
    canvas.paste(app, position)
    centered(draw, 992, f'{index + 1}/{len(SCENES)}  {title}', 23, bold=True)
    centered(draw, 1030, caption, 17, MUTED)
    if touch is not None:
        touch = (position[0] + (touch[0] - crop[0]) * app.width / (crop[2] - crop[0]),
                 position[1] + (touch[1] - crop[1]) * app.height / (crop[3] - crop[1]))
    return canvas, touch


def pulse(frame, point, progress):
    overlay = Image.new('RGBA', SIZE)
    draw = ImageDraw.Draw(overlay)
    x, y = point
    radius = 13 + 27 * progress
    alpha = round(220 * (1 - .6 * progress))
    draw.ellipse((x - radius, y - radius, x + radius, y + radius),
                 fill=(8, 126, 245, round(45 * (1 - progress))),
                 outline=(8, 126, 245, alpha), width=4)
    draw.ellipse((x - 6, y - 6, x + 6, y + 6), fill=(255, 255, 255, 240),
                 outline=(8, 126, 245, 255), width=2)
    return Image.alpha_composite(frame.convert('RGBA'), overlay).convert('RGB')


def build():
    scenes = [scene_frame(scene, index) for index, scene in enumerate(SCENES)]
    # One palette for the full film, including the blue/white touch indicator.
    samples = Image.new('RGB', (150 * len(scenes), 270))
    for index, (frame, _) in enumerate(scenes):
        samples.paste(frame.resize((150, 270), Image.Resampling.LANCZOS), (150 * index, 0))
    palette = samples.quantize(colors=256, method=Image.Quantize.MEDIANCUT)
    frames, durations = [], []

    def append(frame, duration):
        frames.append(frame.quantize(palette=palette, dither=Image.Dither.NONE))
        durations.append(duration)

    for index, (frame, point) in enumerate(scenes):
        append(frame, SCENES[index][-1])
        if point is not None:
            for step in range(6):
                append(pulse(frame, point, step / 5), 100)
        following = scenes[(index + 1) % len(scenes)][0]
        for step in range(1, 6):
            append(Image.blend(frame, following, step / 5), 50)

    gif_path = ROOT / 'demo-mini-app-v2.gif'
    frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, disposal=1, optimize=False, include_color_table=False,
                   comment=b'Navigation mockup demonstration; no real submission.')

    # Show all nine stages and their actual touch locations on one review sheet.
    sheet = Image.new('RGB', (900, 1740), BACKGROUND)
    for index, (frame, point) in enumerate(scenes):
        preview = pulse(frame, point, .6) if point else frame
        sheet.paste(preview.resize((300, 540), Image.Resampling.LANCZOS),
                    ((index % 3) * 300, (index // 3) * 576 + 40))
    sheet_draw = ImageDraw.Draw(sheet)
    sheet_draw.text((20, 12), 'Roteiro · Demonstração do mockup', font=font(20, True), fill=INK)
    sheet.save(ROOT / 'demo-preview-v2.png')

    # Decode every composited frame: opening only the first frame is insufficient.
    duration = 0
    with Image.open(gif_path) as animation:
        assert animation.size == SIZE and animation.info['loop'] == 0
        for index in range(animation.n_frames):
            animation.seek(index)
            animation.convert('RGB').load()
            duration += animation.info['duration']
        frame_count = animation.n_frames
    assert duration == sum(durations), (duration, sum(durations))
    assert 32000 <= duration <= 40000
    assert gif_path.stat().st_size < 10_000_000
    sources = {scene[0] for scene in SCENES}
    print(json.dumps({'pillow': pillow_version, 'gif': str(gif_path), 'dimensions': SIZE,
                      'frames_decoded': frame_count, 'duration_ms': duration, 'loop': 0,
                      'bytes': gif_path.stat().st_size, 'fixed_palette_colors': 256,
                      'source_sha256': {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                                        for name in sorted(sources)}}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    build()

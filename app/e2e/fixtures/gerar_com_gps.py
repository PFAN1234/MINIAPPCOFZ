"""Gera `com-gps.jpg`: JPEG 2400×1600 com EXIF contendo GPS (IFD 0x8825).

Usado pelo teste Playwright do Novo registro, que confere que a compressão
do app descarta o EXIF (inclusive a localização) e reduz a foto a 1920 px.

Execute uma vez, a partir da pasta `app/`:
    python3 e2e/fixtures/gerar_com_gps.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

LARGURA, ALTURA = 2400, 1600
DESTINO = Path(__file__).with_name("com-gps.jpg")

# Ponto de referência arbitrário (Florianópolis, SC): 27°35'47"S 48°32'56"W,
# em graus, minutos e segundos.
LATITUDE = (27, 35, 47)
LONGITUDE = (48, 32, 56)


def desenhar() -> Image.Image:
    """Degradê com formas, determinístico (sem ruído aleatório, para o JPEG ficar pequeno)."""
    img = Image.new("RGB", (LARGURA, ALTURA))
    px = img.load()
    for y in range(ALTURA):
        for x in range(LARGURA):
            px[x, y] = (x * 255 // LARGURA, y * 255 // ALTURA, (x + y) * 255 // (LARGURA + ALTURA))
    d = ImageDraw.Draw(img)
    d.rectangle((200, 200, 900, 700), fill=(240, 240, 235))
    d.ellipse((1400, 300, 2100, 1000), fill=(30, 60, 90))
    d.polygon([(300, 1500), (1000, 900), (1700, 1500)], fill=(250, 210, 80))
    return img


def exif_com_gps() -> Image.Exif:
    exif = Image.Exif()
    exif[0x010F] = "Diário da obra (teste)"  # Make
    exif[0x0110] = "Câmera de teste"  # Model
    # GPSInfo (0x8825): referência e coordenadas, em DMS.
    exif[0x8825] = {
        0x0001: "S",  # GPSLatitudeRef
        0x0002: LATITUDE,  # GPSLatitude
        0x0003: "W",  # GPSLongitudeRef
        0x0004: LONGITUDE,  # GPSLongitude
    }
    return exif


def main() -> None:
    img = desenhar()
    img.save(DESTINO, format="JPEG", quality=85, exif=exif_com_gps().tobytes())
    print(f"Gerado {DESTINO} ({DESTINO.stat().st_size} bytes)")


if __name__ == "__main__":
    main()

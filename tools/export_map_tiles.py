#!/usr/bin/env python3
"""Build a local, native-resolution-capped Blue Marble image pyramid."""
import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
# The 4096 × 2048 base globe covers coarser views, so the pyramid starts at 5400 pixels wide.
MIN_LEVEL, MAX_LEVEL = 1, 3
DEFAULT_SOURCE = Path.home() / 'sda/basemaps/world.topo.bathy.200409.3x21600x10800.jpg'
Image.MAX_IMAGE_PIXELS = 250_000_000


def build(source, output, check=False):
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    with Image.open(source) as original:
        if original.size != (21600, 10800):
            raise ValueError('Expected the 21600 × 10800 NASA Blue Marble source')
        original = original.convert('RGB')
        manifest = {
            'schema_version': 1,
            'source': {'name': 'NASA Blue Marble Next Generation',
                       'file': source.name, 'sha256': source_hash,
                       'width': 21600, 'height': 10800,
                       'url': 'https://visibleearth.nasa.gov/collection/1484/blue-marble'},
            'tile_size': 675, 'gutter': 1, 'base_columns': 4, 'base_rows': 2,
            'min_level': MIN_LEVEL, 'max_level': MAX_LEVEL, 'format': 'jpg', 'quality': 84,
            'levels': [], 'tiles': {},
        }
        for level in range(MIN_LEVEL, MAX_LEVEL + 1):
            cols, rows = 4 << level, 2 << level
            width, height = cols * 675, rows * 675
            image = original if original.size == (width, height) else original.resize((width, height), Image.Resampling.LANCZOS)
            padded = Image.new('RGB', (width + 2, height + 2))
            padded.paste(image, (1, 1))
            padded.paste(image.crop((width - 1, 0, width, height)), (0, 1))
            padded.paste(image.crop((0, 0, 1, height)), (width + 1, 1))
            padded.paste(padded.crop((0, 1, width + 2, 2)), (0, 0))
            padded.paste(padded.crop((0, height, width + 2, height + 1)), (0, height + 1))
            manifest['levels'].append({'level': level, 'columns': cols, 'rows': rows, 'width': width, 'height': height})
            for y in range(rows):
                for x in range(cols):
                    name = f'{level}/{x}/{y}.jpg'
                    tile = padded.crop((x * 675, y * 675, (x + 1) * 675 + 2, (y + 1) * 675 + 2))
                    from io import BytesIO
                    buffer = BytesIO()
                    tile.save(buffer, format='JPEG', quality=84, subsampling=0, optimize=True)
                    content = buffer.getvalue()
                    dest = output / name
                    if check:
                        if not dest.exists() or dest.read_bytes() != content:
                            raise ValueError(f'Tile differs: {name}')
                    else:
                        dest.parent.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(content)
                    manifest['tiles'][name] = hashlib.sha256(content).hexdigest()
            print(f'Level {level}: {width} × {height}, {cols * rows} tiles', flush=True)
        stale = sorted(p for p in output.rglob('*.jpg') if p.relative_to(output).as_posix() not in manifest['tiles'])
        if check and stale:
            raise ValueError(f'Unlisted tiles: {", ".join(p.relative_to(output).as_posix() for p in stale[:5])}')
        for path in stale:
            path.unlink()
        for folder in sorted({p.parent for p in stale}, key=lambda p: len(p.parts), reverse=True):
            while folder != output and folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
                folder = folder.parent
        content = json.dumps(manifest, indent=2) + '\n'
        path = output / 'manifest.json'
        if check:
            if path.read_text() != content:
                raise ValueError('Tile manifest differs')
        else:
            path.write_text(content)
    print(f'{len(manifest["tiles"])} tiles, max native 21600 × 10800')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/tex/tiles')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    build(args.source, args.output, args.check)

"""Collect notices from the exact downloaded distributions (no third-party modules)."""
import email
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / 'public' / 'runtime'
lock = json.loads((ROOT / 'runtime-lock.json').read_text(encoding='utf-8'))
sections = ['# Third-party browser runtime notices\n',
            'These notices are collected from the pinned distributions in runtime-lock.json. '
            'Source archives and upstream locations are recorded there.\n']
def decode_notice(data):
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        # Older distributions include Latin-1 copyright notices.
        return data.decode('latin-1')

for asset in lock['assets']:
    path = TARGET / asset['path']
    if asset['kind'] == 'notice':
        sections.extend([f"\n## {asset['name']} {asset['version']}\n", path.read_text(encoding='utf-8', errors='replace')])
    elif asset['path'].endswith('.whl'):
        sections.append(f"\n## {asset['name']} {asset['version']}\n")
        with zipfile.ZipFile(path) as archive:
            entries = [n for n in archive.namelist() if not n.endswith('/')]
            metadata = next((n for n in entries if n.endswith('.dist-info/METADATA')), None)
            if metadata:
                parsed = email.message_from_bytes(archive.read(metadata))
                sections.append('Declared licence: ' + str(parsed.get('License-Expression') or parsed.get('License') or asset.get('license') or 'See notices below') + '\n')
            licenses = [n for n in entries if ('.dist-info/licenses/' in n or any(word in Path(n).name.lower()
                for word in ('license', 'licence', 'copying', 'notice', 'copyright'))) and not n.endswith(('.py', '.pyc', '.so'))]
            if not licenses:
                sections.append('No separate notice file in wheel; consult the distribution METADATA and upstream source.\n')
            for entry in licenses:
                sections.append(f'\n### {entry}\n')
                sections.append(decode_notice(archive.read(entry)))
(TARGET / 'THIRD_PARTY_NOTICES.txt').write_text('\n'.join(sections), encoding='utf-8')

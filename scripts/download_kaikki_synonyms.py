"""Download the reviewed snapshot once; subsequent runs validate its SHA256."""
from hashlib import sha256
import json
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl.gz'
SHA256 = '6d40e0067718aeb3321db30297761ca803838390627111a29a5426fee4557faf'


def main():
    target = ROOT / 'data/lexical/kaikki-en-2026-10-03.jsonl.gz'
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        # This URL is mutable upstream. A newer dump must be reviewed and pinned
        # explicitly rather than silently changing the released dictionary.
        with urlopen(URL, timeout=90) as response, target.open('wb') as output:
            while True:
                chunk = response.read(4 * 1024 * 1024)
                if not chunk: break
                output.write(chunk)
    digest = sha256(target.read_bytes()).hexdigest()
    if digest != SHA256:
        raise ValueError('Unexpected upstream snapshot; review and pin it before importing')
    source = {'url': URL, 'bytes': target.stat().st_size, 'sha256': digest, 'extracted': '2026-10-03',
              'dump': '2026-09-02', 'license': 'CC-BY-SA-4.0', 'source_page': 'https://kaikki.org/dictionary/English/index.html'}
    (target.parent / 'kaikki-en-2026-10-03.source.json').write_text(json.dumps(source, indent=2) + '\n', encoding='utf-8')
    print('Pinned snapshot verified:', digest)


if __name__ == '__main__': main()

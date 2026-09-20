"""Download immutable BTS monthly archives; reruns validate and reuse files."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'data/raw/flights'

def download(month):
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f'2025-{month:02}.zip'
    url = ('https://transtats.bts.gov/PREZIP/'
           f'On_Time_Reporting_Carrier_On_Time_Performance_1987_present_2025_{month}.zip')
    if not path.exists():
        temp = path.with_suffix('.zip.part')
        subprocess.run(['curl', '-fLsS', '--retry', '4', '--connect-timeout', '30',
                        '--max-time', '600', '-o', str(temp), url], check=True)
        with zipfile.ZipFile(temp) as archive:
            assert archive.testzip() is None, f'ZIP corruption: {temp}'
        temp.rename(path)
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        members = archive.namelist()
    record = dict(file=str(path.relative_to(ROOT)), url=url, bytes=path.stat().st_size,
                  sha256=hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
                  if hasattr(hashlib, 'file_digest') else hashlib.sha256(path.read_bytes()).hexdigest(),
                  verified_at=datetime.now(timezone.utc).isoformat(), members=members)
    print(f'Validated {path.name}: {record["bytes"]:,} bytes', flush=True)
    return record

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records = list(pool.map(download, range(1, 13)))
    (ROOT / 'data/raw/flights_manifest.json').write_text(json.dumps(records, indent=2)+'\n')

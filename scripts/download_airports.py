"""Export BTS Master Coordinate with a session-preserving ASP.NET form request."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile
import urllib.parse
import zipfile
import json
import hashlib
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://transtats.bts.gov/DL_SelectFields.aspx?QO_fu146_anzr=N8vn6v10%20f722146%20gnoyr5&gnoyr_VQ=FLL'
FIELDS = ['AIRPORT_SEQ_ID','AIRPORT_ID','AIRPORT','DISPLAY_AIRPORT_NAME',
          'DISPLAY_AIRPORT_CITY_NAME_FULL','AIRPORT_STATE_CODE','LATITUDE',
          'LONGITUDE','AIRPORT_START_DATE','AIRPORT_THRU_DATE']

class Form(HTMLParser):
    def __init__(self):
        super().__init__()
        self.fields = {}
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'input' and a.get('type') == 'hidden':
            self.fields[a['name']] = a.get('value', '')

if __name__ == '__main__':
    out = ROOT / 'data/raw/airports/master_coordinate.zip'
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        with tempfile.TemporaryDirectory() as temp:
            tmp = Path(temp)
            base = ['curl','-fLsS','--retry','3','--max-time','180','-b',str(tmp/'cookies'),'-c',str(tmp/'cookies')]
            subprocess.run(base+['-o',str(tmp/'page'),URL], check=True)
            parser = Form()
            parser.feed((tmp/'page').read_text())
            parser.fields.update({k:'on' for k in FIELDS})
            parser.fields.update(cboGeography='All',cboYear='All',cboPeriod='All',btnDownload='Download')
            (tmp/'post').write_text(urllib.parse.urlencode(parser.fields))
            subprocess.run(base+['--data-binary','@'+str(tmp/'post'),'-o',str(tmp/'response'),URL],check=True)
            payload = tmp/'response'
            if not zipfile.is_zipfile(payload):
                (ROOT/'data/raw/airports/download_response.html').write_bytes(payload.read_bytes())
                raise RuntimeError('BTS did not return a ZIP; response saved for diagnosis')
            with zipfile.ZipFile(payload) as z:
                assert z.testzip() is None
            out.write_bytes(payload.read_bytes())
    record = dict(url=URL,fields=FIELDS,file=str(out.relative_to(ROOT)),bytes=out.stat().st_size,
                  sha256=hashlib.sha256(out.read_bytes()).hexdigest(),verified_at=datetime.now(timezone.utc).isoformat())
    (out.parent/'manifest.json').write_text(json.dumps(record,indent=2)+'\n')
    print(record)

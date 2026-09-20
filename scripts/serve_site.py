"""Serve only the public site; Ctrl+C stops this server without affecting others."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    site = Path(__file__).resolve().parents[1] / 'site'
    if not (site / 'data/manifest.json').exists():
        parser.error('Missing website data. Run scripts/export_site_data.py first.')
    handler = partial(SimpleHTTPRequestHandler, directory=str(site))
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), handler)
    except OSError as exc:
        parser.exit(1, f'Cannot bind port {args.port}: {exc}. Choose another --port.\n')
    with server:
        print(f'Website: http://127.0.0.1:{args.port}/\nPress Ctrl+C to stop.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nServer stopped.')


if __name__ == '__main__':
    main()

"""Project preview server: do not serve local secrets, SQL state, dependencies or Git."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote
import argparse
root = Path(__file__).resolve().parents[2]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def send_head(self):
        segments = [s for s in unquote(urlsplit(self.path).path).split('/') if s]
        resolved = Path(self.translate_path(self.path)).resolve()
        relative = resolved.relative_to(root).parts if resolved.is_relative_to(root) else ('.blocked',)
        if any(s.startswith('.') or s in ('node_modules', '__pycache__') for s in (*segments, *relative)) or (relative and relative[0] == 'cloudflare' and (len(relative) < 2 or relative[1] != 'public')):
            self.send_error(403, 'Private development files'); return None
        if resolved.is_dir():
            self.send_error(403, 'Directory listing disabled'); return None
        return super().send_head()
if __name__ == '__main__':
    parser = argparse.ArgumentParser();parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    print(f'Open http://127.0.0.1:{args.port}/pasture.html', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()

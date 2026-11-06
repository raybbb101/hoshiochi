# 開発用: キャッシュしない静的サーバー（python3 tools/serve.py）
import http.server, functools, os, sys
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()
    def log_message(self, *a): pass
root = os.path.join(os.path.dirname(__file__), "..")
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
http.server.ThreadingHTTPServer(("", port), functools.partial(H, directory=root)).serve_forever()

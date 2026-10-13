# Receives the bench page's JSON result (POST /result) and writes it to the file given as argv[2] (the scratchpad).
# Bench-only, bound to 127.0.0.1. Usage: python3 resultserver.py <port> <out-file>
import http.server, sys
PORT, OUT = int(sys.argv[1]), sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf8')
        with open(OUT + '.tmp', 'w', encoding='utf8') as f: f.write(body)
        import os; os.replace(OUT + '.tmp', OUT)
        self.send_response(204); self._cors(); self.end_headers()
    def log_message(self, *a): pass
http.server.HTTPServer(('127.0.0.1', PORT), H).serve_forever()

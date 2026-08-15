from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json, os, urllib.request, urllib.error

HOST = '127.0.0.1'
PORT = int(os.getenv('GEEK_TRANSLATION_PORT', '18991'))
POOL = os.getenv('GEEK_POOL_URL', 'http://127.0.0.1:8899').rstrip('/')
MODELS = [m.strip() for m in os.getenv('GEEK_TRANSLATION_MODELS', 'mistral-small-latest,llama-3.3-70b-versatile,gemini-flash-latest').split(',') if m.strip()]
LANG_NAMES = {
    'zh': 'Chinese', 'en': 'English', 'it': 'Italian', 'es': 'Spanish',
    'fr': 'French', 'de': 'German', 'pt': 'Portuguese', 'ja': 'Japanese',
    'ko': 'Korean', 'hi': 'Hindi', 'ar': 'Arabic', 'ru': 'Russian',
    'id': 'Indonesian', 'pl': 'Polish', 'tr': 'Turkish', 'vi': 'Vietnamese',
    'nl': 'Dutch', 'sv': 'Swedish', 'el': 'Greek', 'th': 'Thai',
}


def reply(handler, status, payload):
    raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Content-Length', str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def translate(text, target):
    last_error = 'no model available'
    language = LANG_NAMES.get(target, target)
    for model in MODELS:
        body = {
            'model': model,
            'temperature': 0,
            'max_tokens': 2000,
            'messages': [
                {'role': 'system', 'content': f'Translate the user text faithfully into {language} ({target}). Preserve meaning, names, numbers, dates, URLs, punctuation and line breaks. Do not explain. Output only the {language} translation.'},
                {'role': 'user', 'content': text},
            ],
        }
        req = urllib.request.Request(POOL + '/v1/chat/completions', data=json.dumps(body, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=75) as response:
                data = json.loads(response.read().decode('utf-8'))
            result = data['choices'][0]['message']['content'].strip()
            if result:
                return result, model
        except urllib.error.HTTPError as error:
            last_error = f'{model}: upstream {error.code}'
        except Exception as error:
            last_error = f'{model}: {type(error).__name__}'
    raise RuntimeError(last_error)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/health':
            return reply(self, 200, {'ok': True, 'models': len(MODELS)})
        return reply(self, 404, {'error': 'not_found'})

    def do_POST(self):
        if self.path != '/v1/translate':
            return reply(self, 404, {'error': 'not_found'})
        try:
            length = int(self.headers.get('content-length', '0'))
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            text = str(body.get('text', ''))
            source = str(body.get('source', 'auto'))
            target = str(body.get('target', '')).lower()
            if not text.strip():
                return reply(self, 400, {'error': 'empty_text'})
            if not target or target == 'auto':
                return reply(self, 400, {'error': 'invalid_target'})
            result, model = translate(text, target)
            return reply(self, 200, {'text': result, 'source': source, 'target': target, 'engine': model})
        except json.JSONDecodeError:
            return reply(self, 400, {'error': 'invalid_json'})
        except Exception as error:
            return reply(self, 502, {'error': str(error)[:200]})

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    print(f'[geek-translation] http://{HOST}:{PORT} pool={POOL} models={len(MODELS)}', flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

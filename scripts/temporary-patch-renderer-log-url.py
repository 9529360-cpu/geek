from pathlib import Path

app_path = Path('ui/app.js')
app = app_path.read_text(encoding='utf-8')
old_block = """    window.__wvLog = window.__wvLog || [];
    ['dom-ready', 'did-finish-load', 'did-fail-load', 'did-start-loading', 'did-stop-loading'].forEach((evt) => {
      wv.addEventListener(evt, (e) => {
        let detail = '';
        if (evt === 'did-fail-load') {
          detail = ` code=${e.errorCode} desc=${e.errorDescription} url=${e.validatedURL}`;
        }
        window.__wvLog.push(`${evt}${detail}`);
        try { window.__wvLog.push(`url=${wv.getURL && wv.getURL()}`); } catch (err) {}
      });
    });
"""
new_block = """    window.__wvLog = window.__wvLog || [];
    const safeWebviewLogUrl = (value) => {
      try {
        const sanitize = window.GeekLogUrl && window.GeekLogUrl.sanitizeUrlForLog;
        return typeof sanitize === 'function' ? sanitize(value) : '';
      } catch {
        return '';
      }
    };
    ['dom-ready', 'did-finish-load', 'did-fail-load', 'did-start-loading', 'did-stop-loading'].forEach((evt) => {
      wv.addEventListener(evt, (e) => {
        let detail = '';
        if (evt === 'did-fail-load') {
          detail = ` code=${e.errorCode} desc=${e.errorDescription} url=${safeWebviewLogUrl(e.validatedURL)}`;
        }
        window.__wvLog.push(`${evt}${detail}`);
        try { window.__wvLog.push(`url=${safeWebviewLogUrl(wv.getURL && wv.getURL())}`); } catch (err) {}
      });
    });
"""
if app.count(old_block) != 1:
    raise SystemExit('renderer WebView log block anchor mismatch')
if 'const safeWebviewLogUrl' in app:
    raise SystemExit('renderer WebView log patch already applied')
app_path.write_text(app.replace(old_block, new_block, 1), encoding='utf-8')

index_path = Path('ui/index.html')
index = index_path.read_text(encoding='utf-8')
old_scripts = """<script src="translation-adapters.js"></script>
<script src="app.js"></script>"""
new_scripts = """<script src="translation-adapters.js"></script>
<script src="log-url.js"></script>
<script src="app.js"></script>"""
if index.count(old_scripts) != 1:
    raise SystemExit('renderer script order anchor mismatch')
if '<script src="log-url.js"></script>' in index:
    raise SystemExit('renderer URL helper already loaded')
index_path.write_text(index.replace(old_scripts, new_scripts, 1), encoding='utf-8')

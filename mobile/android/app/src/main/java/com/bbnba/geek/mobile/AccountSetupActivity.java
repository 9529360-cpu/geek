package com.bbnba.geek.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.content.SharedPreferences;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.bbnba.geek.mobile.runtime.BrowserRuntime;
import com.bbnba.geek.mobile.runtime.WebBrowserRuntime;
import com.bbnba.geek.mobile.translation.GeekSessionStore;
import com.bbnba.geek.mobile.translation.GeekTranslationClient;
import com.bbnba.geek.mobile.translation.TranslationSettingsStore;

import java.util.ArrayDeque;
import java.util.function.Consumer;

import org.json.JSONObject;
import org.json.JSONTokener;

public class AccountSetupActivity extends Activity {
    public static final String EXTRA_PLATFORM = "platform";
    public static final String EXTRA_ACCOUNT_NAME = "account_name";
    public static final String EXTRA_CLEAR_DATA = "clear_data";
    public static final String EXTRA_SLOT = "slot";

    private static final int BG = Color.rgb(11, 13, 18);
    private static final int SURFACE = Color.rgb(20, 24, 33);
    private static final int TEXT = Color.rgb(241, 244, 249);
    private static final int MUTED = Color.rgb(143, 151, 169);
    private final ArrayDeque<Long> recoveryAttempts = new ArrayDeque<>();
    private final BrowserRuntime runtime = new WebBrowserRuntime();
    private FrameLayout webContainer;
    private TextView status;
    private WebView webView;
    private String platform;
    private String accountName;
    private TranslationSettingsStore translationSettings;
    private GeekSessionStore geekSessionStore;
    private GeekTranslationClient translationClient;
    private SharedPreferences floatingPreferences;
    private String floatingPreferenceKey;
    private volatile String currentPageUrl = "";
    private static boolean webViewDirectoryConfigured;
    private static final String[] LANGUAGE_CODES = {
            "en", "es", "fr", "de", "it", "pt", "zh", "ja", "ko", "hi", "ar", "ru", "id", "pl", "tr", "vi", "nl", "sv", "el", "th"
    };
    private static final String[] LANGUAGE_NAMES = {
            "英语", "西班牙语", "法语", "德语", "意大利语", "葡萄牙语", "中文", "日语", "韩语", "印地语", "阿拉伯语", "俄语", "印尼语", "波兰语", "土耳其语", "越南语", "荷兰语", "瑞典语", "希腊语", "泰语"
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        configureWebViewDirectoryOnce();
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        platform = getIntent().getStringExtra(EXTRA_PLATFORM);
        if (!"telegram".equals(platform) && !"line".equals(platform)) platform = "whatsapp";
        accountName = getIntent().getStringExtra(EXTRA_ACCOUNT_NAME);
        if (accountName == null || accountName.trim().isEmpty()) accountName = runtime.displayName(platform) + " 1";
        if (getIntent().getBooleanExtra(EXTRA_CLEAR_DATA, false)) {
            clearIsolatedWebData();
            return;
        }
        int slot = getIntent().getIntExtra(EXTRA_SLOT, 0);
        translationSettings = new TranslationSettingsStore(this, platform + "_slot_" + slot);
        geekSessionStore = new GeekSessionStore(this);
        translationClient = new GeekTranslationClient(geekSessionStore);
        floatingPreferences = getSharedPreferences("floating_tools", MODE_PRIVATE);
        floatingPreferenceKey = platform + "_slot_" + slot;
        if (slot == 0) {
            getSharedPreferences("accounts", MODE_PRIVATE).edit().putString("last_platform", platform).apply();
        }
        setContentView(buildContent());
        createWebView();
    }

    protected String webViewDataDirectorySuffix() {
        return null;
    }

    private void configureWebViewDirectoryOnce() {
        String suffix = webViewDataDirectorySuffix();
        if (suffix == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        synchronized (AccountSetupActivity.class) {
            if (!webViewDirectoryConfigured) {
                WebView.setDataDirectorySuffix(suffix);
                webViewDirectoryConfigured = true;
            }
        }
    }

    private void clearIsolatedWebData() {
        WebView cleaner = new WebView(this);
        cleaner.clearCache(true);
        cleaner.clearFormData();
        cleaner.clearHistory();
        WebStorage.getInstance().deleteAllData();
        CookieManager.getInstance().removeAllCookies(value -> {
            CookieManager.getInstance().flush();
            cleaner.destroy();
            setResult(RESULT_OK, getIntent());
            finish();
        });
    }

    private View buildContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(8), dp(7), dp(8), dp(7));
        bar.setBackgroundColor(SURFACE);

        Button back = control("‹", "返回账号空间");
        back.setOnClickListener(v -> finish());
        bar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(50)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(8), 0, dp(8), 0);
        copy.addView(text(accountName, 15, TEXT));
        status = text("正在建立安全会话…", 11, MUTED);
        copy.addView(status);
        bar.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));

        Button reload = control("↻", "刷新登录页");
        reload.setOnClickListener(v -> {
            if (webView != null) webView.reload();
        });
        bar.addView(reload, new LinearLayout.LayoutParams(dp(48), dp(50)));
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(66)));

        FrameLayout accountSurface = new FrameLayout(this);
        accountSurface.setBackgroundColor(Color.WHITE);
        webContainer = new FrameLayout(this);
        accountSurface.addView(webContainer, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout quickActions = new LinearLayout(this);
        quickActions.setOrientation(LinearLayout.VERTICAL);
        quickActions.setGravity(Gravity.CENTER);
        Button translation = floatingAction("译", "打开当前账户翻译");
        translation.setOnClickListener(v -> showTranslationPanel());
        quickActions.addView(translation, new LinearLayout.LayoutParams(dp(54), dp(54)));
        Button broadcast = floatingAction("发", "打开当前账户群发");
        broadcast.setOnClickListener(v -> showBroadcastPanel());
        LinearLayout.LayoutParams broadcastParams = new LinearLayout.LayoutParams(dp(54), dp(54));
        broadcastParams.topMargin = dp(10);
        quickActions.addView(broadcast, broadcastParams);
        FrameLayout.LayoutParams quickParams = new FrameLayout.LayoutParams(dp(64), dp(128), Gravity.END | Gravity.BOTTOM);
        quickParams.rightMargin = dp(12);
        quickParams.bottomMargin = dp(18);
        accountSurface.addView(quickActions, quickParams);
        attachFloatingDrag(translation, quickActions, accountSurface);
        attachFloatingDrag(broadcast, quickActions, accountSurface);
        quickActions.post(() -> restoreFloatingPosition(quickActions, accountSurface));
        root.addView(accountSurface, new LinearLayout.LayoutParams(-1, 0, 1f));

        TextView privacy = text("登录数据仅保存在当前 App 沙箱 · 不接入商业消息 API", 10, MUTED);
        privacy.setGravity(Gravity.CENTER);
        root.addView(privacy, new LinearLayout.LayoutParams(-1, dp(34)));
        return root;
    }

    private void createWebView() {
        WebView candidate = new WebView(this);
        candidate.setBackgroundColor(Color.WHITE);
        WebSettings settings = candidate.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        settings.setUserAgentString(settings.getUserAgentString() + " GeekMobile/0.1");
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(candidate, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            candidate.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        candidate.setWebViewClient(new AccountWebViewClient());
        candidate.addJavascriptInterface(new TranslationBridge(), "GeekMobileTranslation");
        webContainer.removeAllViews();
        webContainer.addView(candidate, new FrameLayout.LayoutParams(-1, -1));
        webView = candidate;
        status.setText("HTTPS 来源保护已开启");
        candidate.loadUrl(runtime.startUrl(platform));
    }

    private final class AccountWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (runtime.isAllowedOrigin(platform, uri.getScheme(), uri.getHost())) return false;
            Toast.makeText(AccountSetupActivity.this, "已阻止离开当前平台的页面", Toast.LENGTH_SHORT).show();
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            currentPageUrl = url == null ? "" : url;
            CookieManager.getInstance().flush();
            int slot = getIntent().getIntExtra(EXTRA_SLOT, 0);
            String sessionKey = slot == 0
                    ? "session_created_" + platform
                    : "slot_" + slot + "_page_created";
            getSharedPreferences("accounts", MODE_PRIVATE)
                    .edit()
                    .putBoolean(sessionKey, true)
                    .apply();
            status.setText("页面已就绪 · 完成登录后会话将保存在本机");
            installTranslationSendHook();
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            long now = System.currentTimeMillis();
            while (!recoveryAttempts.isEmpty() && now - recoveryAttempts.peekFirst() > 60_000) {
                recoveryAttempts.removeFirst();
            }
            recoveryAttempts.addLast(now);
            webContainer.removeView(view);
            view.destroy();
            webView = null;
            if (recoveryAttempts.size() <= 2) {
                status.setText("网页进程已停止，正在恢复…");
                webContainer.postDelayed(AccountSetupActivity.this::createWebView, 500);
            } else {
                status.setText("连续恢复失败，请返回后重新打开");
                Toast.makeText(AccountSetupActivity.this, "已停止自动恢复，避免崩溃循环", Toast.LENGTH_LONG).show();
            }
            return true;
        }
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webContainer.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private Button control(String glyph, String description) {
        Button button = new Button(this);
        button.setText(glyph);
        button.setTextSize(24);
        button.setTextColor(TEXT);
        button.setBackgroundColor(Color.TRANSPARENT);
        button.setContentDescription(description);
        button.setMinWidth(dp(48));
        button.setMinHeight(dp(48));
        return button;
    }

    private Button floatingAction(String glyph, String description) {
        Button button = new Button(this);
        button.setText(glyph);
        button.setTextSize(16);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setContentDescription(description);
        GradientDrawable background = new GradientDrawable();
        background.setShape(GradientDrawable.OVAL);
        background.setColor(Color.rgb(124, 92, 255));
        background.setStroke(dp(1), Color.rgb(170, 150, 255));
        button.setBackground(background);
        button.setElevation(dp(8));
        return button;
    }

    private void attachFloatingDrag(View handle, View target, View parent) {
        final float[] down = new float[4];
        final boolean[] moved = {false};
        handle.setOnTouchListener((view, event) -> {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                down[0] = event.getRawX();
                down[1] = event.getRawY();
                down[2] = target.getX();
                down[3] = target.getY();
                moved[0] = false;
                view.setPressed(true);
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_MOVE) {
                float dx = event.getRawX() - down[0];
                float dy = event.getRawY() - down[1];
                if (Math.abs(dx) > dp(5) || Math.abs(dy) > dp(5)) moved[0] = true;
                float maxX = Math.max(0, parent.getWidth() - target.getWidth());
                float maxY = Math.max(0, parent.getHeight() - target.getHeight());
                target.setX(Math.max(0, Math.min(maxX, down[2] + dx)));
                target.setY(Math.max(0, Math.min(maxY, down[3] + dy)));
                return true;
            }
            if (event.getActionMasked() == MotionEvent.ACTION_UP || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                view.setPressed(false);
                if (moved[0]) saveFloatingPosition(target);
                else if (event.getActionMasked() == MotionEvent.ACTION_UP) view.performClick();
                return true;
            }
            return false;
        });
    }

    private void restoreFloatingPosition(View target, View parent) {
        String xKey = floatingPreferenceKey + "_x";
        String yKey = floatingPreferenceKey + "_y";
        if (!floatingPreferences.contains(xKey) || !floatingPreferences.contains(yKey)) return;
        float maxX = Math.max(0, parent.getWidth() - target.getWidth());
        float maxY = Math.max(0, parent.getHeight() - target.getHeight());
        target.setX(Math.max(0, Math.min(maxX, floatingPreferences.getFloat(xKey, target.getX()))));
        target.setY(Math.max(0, Math.min(maxY, floatingPreferences.getFloat(yKey, target.getY()))));
    }

    private void saveFloatingPosition(View target) {
        floatingPreferences.edit()
                .putFloat(floatingPreferenceKey + "_x", target.getX())
                .putFloat(floatingPreferenceKey + "_y", target.getY())
                .apply();
    }

    private final class TranslationBridge {
        @JavascriptInterface
        public boolean shouldTranslate(String chatId) {
            if (!isCurrentPageAllowed()) return false;
            TranslationSettingsStore.GlobalConfig global = translationSettings.global();
            if (chatId == null || chatId.trim().isEmpty()) return global.sendEnabled();
            TranslationSettingsStore.ChatConfig chat = translationSettings.chat(chatId.trim());
            return chat.overrideEnabled() ? chat.sendEnabled() : global.sendEnabled();
        }

        @JavascriptInterface
        public void translateAndSend(String requestId, String source, String chatId) {
            if (!isCurrentPageAllowed() || requestId == null || !requestId.matches("[a-zA-Z0-9_-]{8,80}")) return;
            String original = source == null ? "" : source.trim();
            if (original.isEmpty() || original.length() > 10_000) {
                resolveSendTranslation(requestId, "", "消息内容无效，已阻止发送");
                return;
            }
            TranslationSettingsStore.GlobalConfig global = translationSettings.global();
            TranslationSettingsStore.ChatConfig chat = chatId == null || chatId.trim().isEmpty() ? null : translationSettings.chat(chatId.trim());
            boolean enabled = chat != null && chat.overrideEnabled() ? chat.sendEnabled() : global.sendEnabled();
            String target = chat != null && chat.overrideEnabled() ? chat.sendTarget() : global.sendTarget();
            if (!enabled) {
                resolveSendTranslation(requestId, "", "TRANSLATION_DISABLED");
                return;
            }
            translationClient.translate(original, global.sendSource(), target, (result, error) -> {
                if (error != null || result == null) {
                    resolveSendTranslation(requestId, "", error == null ? "翻译失败，原文未发送" : error.getMessage());
                    return;
                }
                resolveSendTranslation(requestId, result.text(), "");
            });
        }
    }

    private boolean isCurrentPageAllowed() {
        if (webView == null || currentPageUrl.isEmpty()) return false;
        Uri uri = Uri.parse(currentPageUrl);
        return runtime.isAllowedOrigin(platform, uri.getScheme(), uri.getHost());
    }

    private void resolveSendTranslation(String requestId, String translated, String error) {
        if (webView == null) return;
        String script = "window.__geekMobileTranslationResolve&&window.__geekMobileTranslationResolve(" +
                JSONObject.quote(requestId) + "," + JSONObject.quote(translated) + "," + JSONObject.quote(error) + ")";
        webView.post(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    private void installTranslationSendHook() {
        if (webView == null || !isCurrentPageAllowed()) return;
        String script = "(function(){try{" +
                "window.__geekMobileSendAbort&&window.__geekMobileSendAbort.abort();var ac=new AbortController();window.__geekMobileSendAbort=ac;var lock=false,pending=new Map(),bypass=false;" +
                "var editor=function(){return document.querySelector('#editable-message-text[contenteditable=\"true\"],footer [contenteditable=\"true\"][role=\"textbox\"],[contenteditable=\"true\"][data-tab],.composer_rich_textarea,textarea');};" +
                "var button=function(){var b=document.querySelector('button.Button.send.main-button,button[aria-label=\"发送消息\"],button[aria-label=\"Send\"],button[title=\"Send\"],.btn-send');if(!b){var i=document.querySelector('[data-icon=\"send\"]');b=i&&i.closest('button');}return b;};" +
                "var value=function(e){return String(('value'in e?e.value:(e.innerText||e.textContent||''))||'').replace(/\\n$/,'').trim();};" +
                "var fill=function(e,t){e.focus();if('value'in e){var p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,d=Object.getOwnPropertyDescriptor(p,'value');if(d&&d.set)d.set.call(e,t);else e.value=t;e.dispatchEvent(new Event('input',{bubbles:true}));}else{var s=getSelection(),r=document.createRange();r.selectNodeContents(e);s.removeAllRanges();s.addRange(r);if(!document.execCommand('insertText',false,t)){e.textContent=t;e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:t}));}}return value(e)===String(t).trim();};" +
                "var chat=function(){try{if('telegram'==='" + platform + "'){var h=String(location.hash||'').replace(/^#/,'');return h?h.split('?')[0]:'';}if('line'==='" + platform + "'){var p=String(location.hash||'').replace(/^#/,'').split('?')[0],m=p.match(/^\\/[^/]+\\/([^/]+)\\/?$/);return m?decodeURIComponent(m[1]):'';}var x=window.WPP&&window.WPP.chat&&window.WPP.chat.getActiveChat&&window.WPP.chat.getActiveChat();return x&&x.id?(x.id._serialized||String(x.id)):'';}catch(z){return '';}};" +
                "var notice=function(t){var n=document.getElementById('geek-mobile-send-error');if(n)n.remove();n=document.createElement('div');n.id='geek-mobile-send-error';n.textContent=t;Object.assign(n.style,{position:'fixed',left:'50%',bottom:'86px',transform:'translateX(-50%)',zIndex:'2147483647',padding:'9px 13px',borderRadius:'9px',background:'#b42318',color:'#fff',fontSize:'13px'});document.body.appendChild(n);setTimeout(function(){n.remove();},3200);};" +
                "window.__geekMobileTranslationResolve=function(id,t,err){var p=pending.get(id);if(!p)return;pending.delete(id);lock=false;if(err){notice(err==='TRANSLATION_DISABLED'?'翻译已关闭':err+'，原文未发送');p.e.focus();return;}if(!fill(p.e,t)){fill(p.e,p.o);notice('译文回填校验失败，原文未发送');return;}bypass=true;(p.b||button())?.click();setTimeout(function(){bypass=false;},0);};" +
                "var run=function(ev,e,b){if(bypass||lock||!e)return;var c=chat();if(!GeekMobileTranslation.shouldTranslate(c))return;var s=value(e);if(!s)return;ev.preventDefault();ev.stopImmediatePropagation();lock=true;var id=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,12);pending.set(id,{e:e,b:b,o:s});GeekMobileTranslation.translateAndSend(id,s,c);};" +
                "document.addEventListener('keydown',function(ev){var e=ev.target&&ev.target.closest&&ev.target.closest('[contenteditable=\"true\"],textarea');if(e&&ev.key==='Enter'&&!ev.shiftKey&&!ev.ctrlKey&&!ev.metaKey&&!ev.isComposing)run(ev,e,button());},{capture:true,signal:ac.signal});" +
                "document.addEventListener('click',function(ev){var b=ev.target&&ev.target.closest&&ev.target.closest('button.Button.send.main-button,button[aria-label=\"发送消息\"],button[aria-label=\"Send\"],button[title=\"Send\"],.btn-send');if(!b){var i=ev.target&&ev.target.closest&&ev.target.closest('[data-icon=\"send\"]');b=i&&i.closest('button');}if(b)run(ev,editor(),b);},{capture:true,signal:ac.signal});return 'READY';" +
                "}catch(e){return 'ERR:'+e.message;}})()";
        webView.evaluateJavascript(script, result -> {
            if ("\"READY\"".equals(result)) status.setText("页面已就绪 · 翻译发送保护已开启");
        });
    }

    private void showTranslationPanel() {
        resolveCurrentChat(this::showTranslationPanelForChat);
    }

    private void showTranslationPanelForChat(String chatId) {
        Dialog dialog = bottomDialog();
        LinearLayout sheet = dialogSheet();
        LinearLayout heading = new LinearLayout(this);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout headingCopy = new LinearLayout(this);
        headingCopy.setOrientation(LinearLayout.VERTICAL);
        headingCopy.addView(text("翻译", 21, TEXT));
        headingCopy.addView(text(accountName + " · 配置仅对此账户生效", 11, MUTED));
        heading.addView(headingCopy, new LinearLayout.LayoutParams(0, -2, 1f));
        Button close = control("×", "关闭翻译设置");
        close.setOnClickListener(v -> dialog.dismiss());
        heading.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));
        sheet.addView(heading, new LinearLayout.LayoutParams(-1, dp(58)));

        LinearLayout tabs = new LinearLayout(this);
        tabs.setPadding(dp(4), dp(4), dp(4), dp(4));
        tabs.setBackground(roundRect(SURFACE, dp(15), Color.rgb(52, 60, 78)));
        Button globalTab = compactSheetTab("全局设置");
        Button chatTab = compactSheetTab("当前对话");
        tabs.addView(globalTab, new LinearLayout.LayoutParams(0, dp(44), 1f));
        tabs.addView(chatTab, new LinearLayout.LayoutParams(0, dp(44), 1f));
        LinearLayout.LayoutParams tabsParams = new LinearLayout.LayoutParams(-1, dp(52));
        tabsParams.topMargin = dp(8);
        sheet.addView(tabs, tabsParams);

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(0, dp(8), 0, dp(8));
        scroll.addView(body, new ScrollView.LayoutParams(-1, -2));
        sheet.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1f));

        Button save = sheetAction("保存并应用");
        LinearLayout.LayoutParams saveParams = new LinearLayout.LayoutParams(-1, dp(50));
        saveParams.topMargin = dp(8);
        sheet.addView(save, saveParams);

        TranslationSettingsStore.GlobalConfig[] global = {translationSettings.global()};
        TranslationSettingsStore.ChatConfig[] chat = {chatId.isEmpty() ? null : translationSettings.chat(chatId)};
        boolean[] showGlobal = {true};
        Runnable[] render = new Runnable[1];
        render[0] = () -> {
            body.removeAllViews();
            styleSheetTab(globalTab, showGlobal[0]);
            styleSheetTab(chatTab, !showGlobal[0]);
            if (showGlobal[0]) renderGlobalTranslationSettings(body, global);
            else renderChatTranslationSettings(body, chatId, global[0], chat, render[0]);
            save.setText(showGlobal[0] ? "保存全局设置" : "保存当前对话设置");
            save.setEnabled(showGlobal[0] || !chatId.isEmpty());
            save.setAlpha(save.isEnabled() ? 1f : 0.45f);
        };
        globalTab.setOnClickListener(v -> { showGlobal[0] = true; render[0].run(); });
        chatTab.setOnClickListener(v -> { showGlobal[0] = false; render[0].run(); });
        save.setOnClickListener(v -> {
            if (showGlobal[0]) translationSettings.saveGlobal(global[0]);
            else if (!chatId.isEmpty() && chat[0] != null) translationSettings.saveChat(chatId, chat[0]);
            dialog.dismiss();
            installTranslationSendHook();
            Toast.makeText(this, showGlobal[0] ? "全局翻译设置已保存" : "当前对话设置已保存", Toast.LENGTH_SHORT).show();
        });
        render[0].run();
        dialog.setContentView(sheet);
        showBottomDialog(dialog);
        Window window = dialog.getWindow();
        if (window != null) window.setLayout(-1, Math.min(dp(720), (int) (getResources().getDisplayMetrics().heightPixels * 0.84f)));
    }

    private void renderGlobalTranslationSettings(LinearLayout body, TranslationSettingsStore.GlobalConfig[] state) {
        TextView intro = text("与 PC 端同步的默认规则，新对话自动继承", 12, MUTED);
        body.addView(intro, matchWrap());

        LinearLayout incoming = translationSection("收到的消息", "自动把对方消息显示成你熟悉的语言");
        incoming.addView(translationSwitch("自动翻译", "关闭后仍可按需手动翻译", state[0].receiveAuto(), checked -> state[0] = new TranslationSettingsStore.GlobalConfig(checked, state[0].receiveTarget(), state[0].groupAuto(), state[0].sendEnabled(), state[0].sendSource(), state[0].sendTarget(), state[0].manualTranslation())));
        incoming.addView(languageRow("翻译成", state[0].receiveTarget(), false, code -> state[0] = new TranslationSettingsStore.GlobalConfig(state[0].receiveAuto(), code, state[0].groupAuto(), state[0].sendEnabled(), state[0].sendSource(), state[0].sendTarget(), state[0].manualTranslation())));
        incoming.addView(translationSwitch("群聊也自动翻译", "只在自动翻译开启时生效", state[0].groupAuto(), checked -> state[0] = new TranslationSettingsStore.GlobalConfig(state[0].receiveAuto(), state[0].receiveTarget(), checked, state[0].sendEnabled(), state[0].sendSource(), state[0].sendTarget(), state[0].manualTranslation())));
        addSpaced(body, incoming);

        LinearLayout outgoing = translationSection("发送消息", "输入习惯不变，发送前翻译并校验译文");
        outgoing.addView(translationSwitch("发送前翻译", "失败时保留草稿，绝不误发原文", state[0].sendEnabled(), checked -> state[0] = new TranslationSettingsStore.GlobalConfig(state[0].receiveAuto(), state[0].receiveTarget(), state[0].groupAuto(), checked, state[0].sendSource(), state[0].sendTarget(), state[0].manualTranslation())));
        outgoing.addView(languageRow("我通常使用", state[0].sendSource(), true, code -> state[0] = new TranslationSettingsStore.GlobalConfig(state[0].receiveAuto(), state[0].receiveTarget(), state[0].groupAuto(), state[0].sendEnabled(), code, state[0].sendTarget(), state[0].manualTranslation())));
        outgoing.addView(languageRow("发送为", state[0].sendTarget(), false, code -> state[0] = new TranslationSettingsStore.GlobalConfig(state[0].receiveAuto(), state[0].receiveTarget(), state[0].groupAuto(), state[0].sendEnabled(), state[0].sendSource(), code, state[0].manualTranslation())));
        addSpaced(body, outgoing);
    }

    private void renderChatTranslationSettings(LinearLayout body, String chatId, TranslationSettingsStore.GlobalConfig global, TranslationSettingsStore.ChatConfig[] state, Runnable render) {
        if (chatId.isEmpty()) {
            LinearLayout empty = translationSection("还没有选中对话", "先在当前平台打开一个聊天，再设置这个对话的翻译规则");
            TextView follows = text("当前会继续跟随全局设置", 13, MUTED);
            LinearLayout.LayoutParams params = matchWrap();
            params.topMargin = dp(14);
            empty.addView(follows, params);
            addSpaced(body, empty);
            return;
        }

        TextView detected = pill("●  已识别当前对话", Color.rgb(64, 205, 135), SURFACE);
        body.addView(detected, new LinearLayout.LayoutParams(-1, dp(38)));
        LinearLayout mode = translationSection("当前对话", state[0].overrideEnabled() ? "使用单独设置" : "当前跟随全局设置");
        mode.addView(translationSwitch("单独设置", "关闭时始终跟随全局", state[0].overrideEnabled(), checked -> {
            state[0] = new TranslationSettingsStore.ChatConfig(checked, state[0].receiveAuto(), state[0].receiveTarget(), state[0].sendEnabled(), state[0].sendTarget(), state[0].manualTranslation());
            render.run();
        }));
        addSpaced(body, mode);
        if (!state[0].overrideEnabled()) return;

        LinearLayout incoming = translationSection("这个对话的接收设置", "不影响其他对话");
        incoming.addView(translationSwitch("自动翻译收到的消息", "关闭后改为按需翻译", state[0].receiveAuto(), checked -> state[0] = new TranslationSettingsStore.ChatConfig(true, checked, state[0].receiveTarget(), state[0].sendEnabled(), state[0].sendTarget(), state[0].manualTranslation())));
        incoming.addView(languageRow("翻译成", state[0].receiveTarget(), false, code -> state[0] = new TranslationSettingsStore.ChatConfig(true, state[0].receiveAuto(), code, state[0].sendEnabled(), state[0].sendTarget(), state[0].manualTranslation())));
        addSpaced(body, incoming);

        LinearLayout outgoing = translationSection("这个对话的发送设置", "只影响当前聊天");
        outgoing.addView(translationSwitch("发送前翻译", "安全校验不通过就禁止发送", state[0].sendEnabled(), checked -> state[0] = new TranslationSettingsStore.ChatConfig(true, state[0].receiveAuto(), state[0].receiveTarget(), checked, state[0].sendTarget(), state[0].manualTranslation())));
        outgoing.addView(languageRow("发送为", state[0].sendTarget(), false, code -> state[0] = new TranslationSettingsStore.ChatConfig(true, state[0].receiveAuto(), state[0].receiveTarget(), state[0].sendEnabled(), code, state[0].manualTranslation())));
        outgoing.addView(translationSwitch("允许手动翻译", "保留点击翻译能力", state[0].manualTranslation(), checked -> state[0] = new TranslationSettingsStore.ChatConfig(true, state[0].receiveAuto(), state[0].receiveTarget(), state[0].sendEnabled(), state[0].sendTarget(), checked)));
        addSpaced(body, outgoing);

        Button reset = sheetSecondaryAction("恢复为全局设置");
        reset.setOnClickListener(v -> {
            translationSettings.resetChat(chatId);
            state[0] = new TranslationSettingsStore.ChatConfig(false, global.receiveAuto(), global.receiveTarget(), global.sendEnabled(), global.sendTarget(), global.manualTranslation());
            render.run();
        });
        LinearLayout.LayoutParams resetParams = new LinearLayout.LayoutParams(-1, dp(48));
        resetParams.topMargin = dp(10);
        body.addView(reset, resetParams);
    }

    private void resolveCurrentChat(Consumer<String> callback) {
        if (webView == null) { callback.accept(""); return; }
        String script = "(function(){try{" +
                "if('telegram'==='" + platform + "'){var h=String(location.hash||'').replace(/^#/,'');if(h)return h.split('?')[0];var a=document.querySelector('#LeftColumn .Chat.active a[href],#LeftColumn .Chat.selected a[href],.Chat.active a[href]');return a?String(a.getAttribute('href')||'').replace(/^#/,''):'';}" +
                "if('line'==='" + platform + "'){var p=String(location.hash||'').replace(/^#/,'').split('?')[0];var m=p.match(/^\\/[^/]+\\/([^/]+)\\/?$/);return m?decodeURIComponent(m[1]):'';}" +
                "var id=window.WPP&&window.WPP.chat&&window.WPP.chat.getActiveChat&&window.WPP.chat.getActiveChat();return id&&id.id?(id.id._serialized||String(id.id)):'';" +
                "}catch(e){return '';}})()";
        webView.evaluateJavascript(script, value -> {
            try {
                Object decoded = new JSONTokener(value).nextValue();
                callback.accept(decoded instanceof String ? ((String) decoded).trim() : "");
            } catch (Exception ignored) {
                callback.accept("");
            }
        });
    }

    private void showBroadcastPanel() {
        Dialog dialog = bottomDialog();
        LinearLayout sheet = dialogSheet();
        sheet.addView(text(accountName + " · 群发", 19, TEXT));
        TextView hint = text("从当前账户选择对象并发送", 12, MUTED);
        LinearLayout.LayoutParams hintParams = matchWrap();
        hintParams.topMargin = dp(5);
        sheet.addView(hint, hintParams);
        Button recipients = sheetAction("选择发送对象");
        recipients.setTextColor(TEXT);
        recipients.setBackground(roundRect(SURFACE, dp(13), Color.rgb(52, 60, 78)));
        LinearLayout.LayoutParams recipientsParams = new LinearLayout.LayoutParams(-1, dp(48));
        recipientsParams.topMargin = dp(16);
        sheet.addView(recipients, recipientsParams);
        EditText message = new EditText(this);
        message.setHint("输入要群发的消息");
        message.setHintTextColor(MUTED);
        message.setTextColor(TEXT);
        message.setTextSize(14);
        message.setGravity(Gravity.TOP);
        message.setPadding(dp(14), dp(12), dp(14), dp(12));
        message.setBackground(roundRect(SURFACE, dp(13), Color.rgb(52, 60, 78)));
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(-1, dp(100));
        messageParams.topMargin = dp(10);
        sheet.addView(message, messageParams);
        Button send = sheetAction("发送");
        send.setOnClickListener(v -> Toast.makeText(this, "群发引擎将在翻译阶段之后接入", Toast.LENGTH_SHORT).show());
        LinearLayout.LayoutParams sendParams = new LinearLayout.LayoutParams(-1, dp(50));
        sendParams.topMargin = dp(14);
        sheet.addView(send, sendParams);
        dialog.setContentView(sheet);
        showBottomDialog(dialog);
    }

    private LinearLayout optionRow(String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        row.setBackground(roundRect(SURFACE, dp(13), Color.rgb(52, 60, 78)));
        row.addView(text(label, 14, TEXT), new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(text(value + "  ›", 13, MUTED));
        return row;
    }

    private LinearLayout.LayoutParams spacedRow() {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(52));
        params.topMargin = dp(10);
        return params;
    }

    private Button sheetAction(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(14);
        button.setTextColor(Color.WHITE);
        button.setAllCaps(false);
        button.setBackground(roundRect(Color.rgb(124, 92, 255), dp(13), Color.rgb(124, 92, 255)));
        return button;
    }

    private Button sheetSecondaryAction(String label) {
        Button button = sheetAction(label);
        button.setTextColor(TEXT);
        button.setBackground(roundRect(SURFACE, dp(13), Color.rgb(52, 60, 78)));
        return button;
    }

    private Button compactSheetTab(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(13);
        button.setTextColor(MUTED);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setPadding(dp(6), 0, dp(6), 0);
        button.setBackgroundColor(Color.TRANSPARENT);
        return button;
    }

    private void styleSheetTab(Button button, boolean selected) {
        button.setTextColor(selected ? Color.WHITE : MUTED);
        button.setBackground(roundRect(selected ? Color.rgb(124, 92, 255) : Color.TRANSPARENT, dp(12), selected ? Color.rgb(124, 92, 255) : Color.TRANSPARENT));
    }

    private LinearLayout translationSection(String title, String subtitle) {
        LinearLayout section = new LinearLayout(this);
        section.setOrientation(LinearLayout.VERTICAL);
        section.setPadding(dp(15), dp(14), dp(15), dp(12));
        section.setBackground(roundRect(SURFACE, dp(16), Color.rgb(52, 60, 78)));
        section.addView(text(title, 15, TEXT));
        TextView detail = text(subtitle, 11, MUTED);
        LinearLayout.LayoutParams detailParams = matchWrap();
        detailParams.topMargin = dp(3);
        detailParams.bottomMargin = dp(6);
        section.addView(detail, detailParams);
        return section;
    }

    @SuppressWarnings("deprecation")
    private View translationSwitch(String label, String detail, boolean checked, Consumer<Boolean> changed) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(7), 0, dp(7));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text(label, 13, TEXT));
        copy.addView(text(detail, 10, MUTED));
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));
        Switch toggle = new Switch(this);
        toggle.setChecked(checked);
        int[][] states = {{android.R.attr.state_checked}, {}};
        toggle.setThumbTintList(new ColorStateList(states, new int[]{Color.WHITE, Color.rgb(155, 162, 178)}));
        toggle.setTrackTintList(new ColorStateList(states, new int[]{Color.rgb(124, 92, 255), Color.rgb(61, 68, 84)}));
        toggle.setOnCheckedChangeListener((button, value) -> changed.accept(value));
        row.addView(toggle, new LinearLayout.LayoutParams(dp(58), dp(44)));
        return row;
    }

    private View languageRow(String label, String code, boolean allowAuto, Consumer<String> changed) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(5), 0, dp(5));
        row.addView(text(label, 13, TEXT), new LinearLayout.LayoutParams(0, -2, 1f));
        Button value = sheetSecondaryAction(languageName(code) + "  ›");
        value.setTextSize(12);
        value.setOnClickListener(v -> selectLanguage(code, allowAuto, selected -> {
            changed.accept(selected);
            value.setText(languageName(selected) + "  ›");
        }));
        row.addView(value, new LinearLayout.LayoutParams(dp(150), dp(42)));
        return row;
    }

    private void selectLanguage(String selected, boolean allowAuto, Consumer<String> callback) {
        int offset = allowAuto ? 1 : 0;
        String[] labels = new String[LANGUAGE_NAMES.length + offset];
        if (allowAuto) labels[0] = "自动检测";
        System.arraycopy(LANGUAGE_NAMES, 0, labels, offset, LANGUAGE_NAMES.length);
        new android.app.AlertDialog.Builder(this)
                .setTitle("选择语言")
                .setSingleChoiceItems(labels, languageIndex(selected, allowAuto), (dialog, which) -> {
                    callback.accept(allowAuto && which == 0 ? "auto" : LANGUAGE_CODES[which - offset]);
                    dialog.dismiss();
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private int languageIndex(String code, boolean allowAuto) {
        if (allowAuto && "auto".equals(code)) return 0;
        for (int i = 0; i < LANGUAGE_CODES.length; i++) {
            if (LANGUAGE_CODES[i].equals(code)) return i + (allowAuto ? 1 : 0);
        }
        return allowAuto ? 0 : 0;
    }

    private String languageName(String code) {
        if ("auto".equals(code)) return "自动检测";
        for (int i = 0; i < LANGUAGE_CODES.length; i++) {
            if (LANGUAGE_CODES[i].equals(code)) return LANGUAGE_NAMES[i];
        }
        return code;
    }

    private void addSpaced(LinearLayout parent, View child) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(10);
        parent.addView(child, params);
    }

    private TextView pill(String value, int foreground, int background) {
        TextView view = text(value, 11, foreground);
        view.setGravity(Gravity.CENTER);
        view.setBackground(roundRect(background, dp(17), Color.rgb(52, 60, 78)));
        return view;
    }

    private Dialog bottomDialog() {
        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        return dialog;
    }

    private LinearLayout dialogSheet() {
        LinearLayout sheet = new LinearLayout(this);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setPadding(dp(20), dp(20), dp(20), dp(22));
        sheet.setBackground(roundRect(Color.rgb(17, 21, 29), dp(22), Color.rgb(52, 60, 78)));
        return sheet;
    }

    private void showBottomDialog(Dialog dialog) {
        Window window = dialog.getWindow();
        if (window == null) return;
        window.setBackgroundDrawableResource(android.R.color.transparent);
        window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        WindowManager.LayoutParams params = window.getAttributes();
        params.width = WindowManager.LayoutParams.MATCH_PARENT;
        params.height = WindowManager.LayoutParams.WRAP_CONTENT;
        params.gravity = Gravity.BOTTOM;
        params.dimAmount = 0.55f;
        window.setAttributes(params);
        dialog.show();
        window.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT);
    }

    private GradientDrawable roundRect(int fill, int radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(-2, -2);
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(-1, -2);
    }

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

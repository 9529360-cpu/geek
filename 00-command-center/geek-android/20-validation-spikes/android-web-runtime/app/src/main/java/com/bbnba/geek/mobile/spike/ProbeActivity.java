package com.bbnba.geek.mobile.spike;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayDeque;
import java.util.Locale;

public final class ProbeActivity extends Activity {
    private static final int BG = Color.rgb(11, 13, 18);
    private static final int SURFACE = Color.rgb(20, 24, 33);
    private static final int TEXT = Color.rgb(241, 244, 249);
    private static final int MUTED = Color.rgb(143, 151, 169);
    private static final int ACCENT = Color.rgb(124, 92, 255);
    private final ArrayDeque<Long> recoveryAttempts = new ArrayDeque<>();
    private LinearLayout webContainer;
    private TextView status;
    private WebView webView;
    private String platform;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        platform = getIntent().getStringExtra("platform");
        if (platform == null) platform = "whatsapp";
        setContentView(buildContent());
        createWebView();
    }

    private View buildContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(10), dp(8), dp(10), dp(8));
        bar.setBackgroundColor(SURFACE);

        Button back = control("‹", "返回");
        back.setOnClickListener(v -> onBackPressed());
        bar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(8), 0, dp(8), 0);
        TextView title = text(displayName(platform) + " · 单账号验证", 15, TEXT);
        status = text("正在创建安全网页容器…", 11, MUTED);
        copy.addView(title);
        copy.addView(status);
        bar.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));

        Button reload = control("↻", "刷新网页");
        reload.setOnClickListener(v -> { if (webView != null) webView.reload(); });
        bar.addView(reload, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(64)));

        webContainer = new LinearLayout(this);
        webContainer.setBackgroundColor(Color.WHITE);
        root.addView(webContainer, new LinearLayout.LayoutParams(-1, 0, 1f));
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
        settings.setUserAgentString(settings.getUserAgentString() + " GeekMobileSpike/0.1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(candidate, true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) candidate.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        candidate.setWebViewClient(new GuardedClient());
        webContainer.removeAllViews();
        webContainer.addView(candidate, new LinearLayout.LayoutParams(-1, -1));
        webView = candidate;
        status.setText("HTTPS 来源保护已开启");
        candidate.loadUrl(startUrl(platform));
    }

    private boolean isAllowed(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme())) return false;
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (platform.equals("whatsapp")) return host.equals("web.whatsapp.com") || host.endsWith(".whatsapp.com");
        if (platform.equals("telegram")) return host.equals("web.telegram.org") || host.endsWith(".telegram.org");
        return host.equals("access.line.me") || host.endsWith(".line.me");
    }

    private String startUrl(String value) {
        if (value.equals("telegram")) return "https://web.telegram.org/a/";
        if (value.equals("line")) return "https://access.line.me/";
        return "https://web.whatsapp.com/";
    }

    private String displayName(String value) {
        if (value.equals("telegram")) return "Telegram";
        if (value.equals("line")) return "LINE";
        return "WhatsApp";
    }

    private final class GuardedClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (isAllowed(request.getUrl())) return false;
            Toast.makeText(ProbeActivity.this, "已阻止非平台页面", Toast.LENGTH_SHORT).show();
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            status.setText("页面已就绪 · 会话由当前 App 沙箱保存");
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            long now = System.currentTimeMillis();
            while (!recoveryAttempts.isEmpty() && now - recoveryAttempts.peekFirst() > 60_000) recoveryAttempts.removeFirst();
            recoveryAttempts.addLast(now);
            webContainer.removeView(view);
            view.destroy();
            webView = null;
            if (recoveryAttempts.size() <= 2) {
                status.setText("网页进程已停止，正在安全恢复…");
                webContainer.postDelayed(ProbeActivity.this::createWebView, 500);
            } else {
                status.setText("连续恢复失败，请返回后重新打开");
                Toast.makeText(ProbeActivity.this, "已停止自动恢复，避免崩溃循环", Toast.LENGTH_LONG).show();
            }
            return true;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
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

    private TextView text(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        return view;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}

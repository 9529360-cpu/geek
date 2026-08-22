package com.bbnba.geek.mobile;

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

import com.bbnba.geek.mobile.runtime.BrowserRuntime;
import com.bbnba.geek.mobile.runtime.WebBrowserRuntime;

import java.util.ArrayDeque;

public final class AccountSetupActivity extends Activity {
    public static final String EXTRA_PLATFORM = "platform";

    private static final int BG = Color.rgb(11, 13, 18);
    private static final int SURFACE = Color.rgb(20, 24, 33);
    private static final int TEXT = Color.rgb(241, 244, 249);
    private static final int MUTED = Color.rgb(143, 151, 169);
    private final ArrayDeque<Long> recoveryAttempts = new ArrayDeque<>();
    private final BrowserRuntime runtime = new WebBrowserRuntime();
    private LinearLayout webContainer;
    private TextView status;
    private WebView webView;
    private String platform;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        platform = getIntent().getStringExtra(EXTRA_PLATFORM);
        if (!"telegram".equals(platform) && !"line".equals(platform)) platform = "whatsapp";
        setContentView(buildContent());
        createWebView();
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
        copy.addView(text(runtime.displayName(platform) + " · 单账号", 15, TEXT));
        status = text("正在建立安全会话…", 11, MUTED);
        copy.addView(status);
        bar.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));

        Button reload = control("↻", "刷新登录页");
        reload.setOnClickListener(v -> {
            if (webView != null) webView.reload();
        });
        bar.addView(reload, new LinearLayout.LayoutParams(dp(48), dp(50)));
        root.addView(bar, new LinearLayout.LayoutParams(-1, dp(66)));

        webContainer = new LinearLayout(this);
        webContainer.setBackgroundColor(Color.WHITE);
        root.addView(webContainer, new LinearLayout.LayoutParams(-1, 0, 1f));

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
        webContainer.removeAllViews();
        webContainer.addView(candidate, new LinearLayout.LayoutParams(-1, -1));
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
            CookieManager.getInstance().flush();
            status.setText("页面已就绪 · 完成登录后会话将保存在本机");
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

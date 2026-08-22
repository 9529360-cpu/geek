package com.bbnba.geek.mobile;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.bbnba.geek.mobile.runtime.BrowserRuntime;
import com.bbnba.geek.mobile.runtime.WebBrowserRuntime;

import java.util.ArrayDeque;

public final class AccountSetupActivity extends Activity {
    public static final String EXTRA_PLATFORM = "platform";
    public static final String EXTRA_ACCOUNT_NAME = "account_name";

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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        platform = getIntent().getStringExtra(EXTRA_PLATFORM);
        if (!"telegram".equals(platform) && !"line".equals(platform)) platform = "whatsapp";
        accountName = getIntent().getStringExtra(EXTRA_ACCOUNT_NAME);
        if (accountName == null || accountName.trim().isEmpty()) accountName = runtime.displayName(platform) + " 1";
        getSharedPreferences("accounts", MODE_PRIVATE).edit().putString("last_platform", platform).apply();
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
            CookieManager.getInstance().flush();
            getSharedPreferences("accounts", MODE_PRIVATE)
                    .edit()
                    .putBoolean("session_created_" + platform, true)
                    .apply();
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

    private void showTranslationPanel() {
        Dialog dialog = bottomDialog();
        LinearLayout sheet = dialogSheet();
        sheet.addView(text(accountName + " · 翻译", 19, TEXT));
        TextView hint = text("设置只作用于当前账户", 12, MUTED);
        LinearLayout.LayoutParams hintParams = matchWrap();
        hintParams.topMargin = dp(5);
        sheet.addView(hint, hintParams);
        sheet.addView(optionRow("收到消息", "翻译为中文"), spacedRow());
        sheet.addView(optionRow("发送消息", "翻译为目标语言"), spacedRow());
        Button confirm = sheetAction("保存翻译设置");
        confirm.setOnClickListener(v -> {
            dialog.dismiss();
            Toast.makeText(this, "翻译引擎将在多开稳定后接入", Toast.LENGTH_SHORT).show();
        });
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(-1, dp(50));
        actionParams.topMargin = dp(16);
        sheet.addView(confirm, actionParams);
        dialog.setContentView(sheet);
        showBottomDialog(dialog);
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

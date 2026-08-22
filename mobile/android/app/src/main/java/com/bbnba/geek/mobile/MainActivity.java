package com.bbnba.geek.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import com.bbnba.geek.mobile.runtime.BrowserRuntime;
import com.bbnba.geek.mobile.runtime.WebBrowserRuntime;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(11, 13, 18);
    private static final int SURFACE = Color.rgb(20, 24, 33);
    private static final int SURFACE_2 = Color.rgb(26, 31, 42);
    private static final int STROKE = Color.rgb(43, 50, 65);
    private static final int TEXT = Color.rgb(241, 244, 249);
    private static final int MUTED = Color.rgb(143, 151, 169);
    private static final int ACCENT = Color.rgb(124, 92, 255);
    private static final int GREEN = Color.rgb(64, 205, 135);

    private final ShellState state = new ShellState();
    private final BrowserRuntime browserRuntime = new WebBrowserRuntime();
    private String selectedPlatform = "whatsapp";
    private LinearLayout content;
    private LinearLayout navigation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        setContentView(buildShell());
        renderSection();
    }

    private View buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(20), dp(16), dp(20), dp(10));

        LinearLayout brandRow = new LinearLayout(this);
        brandRow.setGravity(Gravity.CENTER_VERTICAL);
        TextView brand = text("GEEK", 16, TEXT, true);
        brand.setLetterSpacing(0.08f);
        brandRow.addView(brand, new LinearLayout.LayoutParams(0, dp(36), 1f));
        TextView device = pill("●  本机", GREEN, SURFACE_2);
        brandRow.addView(device, new LinearLayout.LayoutParams(dp(84), dp(34)));
        root.addView(brandRow, new LinearLayout.LayoutParams(-1, dp(42)));

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams contentParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        contentParams.topMargin = dp(12);
        root.addView(content, contentParams);

        navigation = new LinearLayout(this);
        navigation.setOrientation(LinearLayout.HORIZONTAL);
        navigation.setPadding(dp(4), dp(4), dp(4), dp(4));
        navigation.setBackground(roundRect(SURFACE, dp(18), STROKE));
        root.addView(navigation, new LinearLayout.LayoutParams(-1, dp(64)));
        return root;
    }

    private void renderSection() {
        content.removeAllViews();
        if (state.selected() == ShellState.Section.ACCOUNTS) renderAccounts();
        else renderPlaceholder(state.selected());
        renderNavigation();
    }

    private void renderAccounts() {
        content.addView(text("你的移动工作台", 27, TEXT, true));
        TextView intro = text("从一个稳定账号开始，再逐步开启多账号、翻译和群发。", 14, MUTED, false);
        intro.setLineSpacing(0, 1.18f);
        LinearLayout.LayoutParams introParams = wrap();
        introParams.topMargin = dp(7);
        content.addView(intro, introParams);

        LinearLayout stages = new LinearLayout(this);
        stages.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams stagesParams = matchWrap();
        stagesParams.topMargin = dp(20);
        content.addView(stages, stagesParams);
        addStage(stages, "01", "App", true);
        addStage(stages, "02", "多开", false);
        addStage(stages, "03", "翻译", false);
        addStage(stages, "04", "群发", false);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(20), dp(20), dp(18));
        card.setBackground(roundRect(SURFACE, dp(20), STROKE));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        cardParams.topMargin = dp(20);
        cardParams.bottomMargin = dp(16);
        content.addView(card, cardParams);

        TextView kicker = text("账号空间", 12, ACCENT, true);
        kicker.setLetterSpacing(0.08f);
        card.addView(kicker);

        TextView title = text("先连接第一个账号", 21, TEXT, true);
        LinearLayout.LayoutParams titleParams = wrap();
        titleParams.topMargin = dp(10);
        card.addView(title, titleParams);

        TextView body = text("我们会先验证登录、会话保存和重启恢复。通过之后，多开才会真正安全可靠。", 14, MUTED, false);
        body.setLineSpacing(0, 1.25f);
        LinearLayout.LayoutParams bodyParams = matchWrap();
        bodyParams.topMargin = dp(8);
        card.addView(body, bodyParams);

        LinearLayout platforms = new LinearLayout(this);
        platforms.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams platformsParams = matchWrap();
        platformsParams.topMargin = dp(22);
        card.addView(platforms, platformsParams);
        addPlatform(platforms, "whatsapp", "W", "WhatsApp", Color.rgb(37, 211, 102));
        addPlatform(platforms, "telegram", "T", "Telegram", Color.rgb(51, 144, 236));
        addPlatform(platforms, "line", "L", "LINE", Color.rgb(6, 199, 85));

        TextView status = text("当前：正式 App 外壳已就绪", 13, GREEN, true);
        LinearLayout.LayoutParams statusParams = wrap();
        statusParams.topMargin = dp(20);
        card.addView(status, statusParams);

        Button next = action("下一步 · 接入单账号");
        next.setOnClickListener(v -> {
            if (!browserRuntime.isAvailable()) {
                Toast.makeText(this, "单账号登录内核暂不可用", Toast.LENGTH_SHORT).show();
                return;
            }
            Intent intent = new Intent(this, AccountSetupActivity.class);
            intent.putExtra(AccountSetupActivity.EXTRA_PLATFORM, selectedPlatform);
            startActivity(intent);
        });
        content.addView(next, new LinearLayout.LayoutParams(-1, dp(52)));
    }

    private void renderPlaceholder(ShellState.Section section) {
        String title;
        String body;
        if (section == ShellState.Section.CONVERSATIONS) {
            title = "统一会话";
            body = "账号接入后，这里会集中显示不同平台的会话。";
        } else if (section == ShellState.Section.TOOLS) {
            title = "效率工具";
            body = "翻译和群发会按既定顺序开放，不会抢在账号稳定性之前。";
        } else {
            title = "我的极客";
            body = "设备、安全、存储和版本信息会统一放在这里。";
        }
        content.addView(text(title, 27, TEXT, true));
        TextView description = text(body, 14, MUTED, false);
        description.setLineSpacing(0, 1.2f);
        LinearLayout.LayoutParams descriptionParams = matchWrap();
        descriptionParams.topMargin = dp(8);
        content.addView(description, descriptionParams);

        LinearLayout empty = new LinearLayout(this);
        empty.setGravity(Gravity.CENTER);
        empty.setBackground(roundRect(SURFACE, dp(20), STROKE));
        TextView message = text("此模块将在前置能力通过后启用", 15, MUTED, false);
        empty.addView(message);
        LinearLayout.LayoutParams emptyParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        emptyParams.topMargin = dp(22);
        emptyParams.bottomMargin = dp(16);
        content.addView(empty, emptyParams);
    }

    private void renderNavigation() {
        navigation.removeAllViews();
        for (ShellState.Section section : ShellState.Section.values()) {
            boolean selected = state.selected() == section;
            Button button = new Button(this);
            button.setText(section.label());
            button.setTextSize(13);
            button.setTextColor(selected ? Color.WHITE : MUTED);
            button.setTypeface(Typeface.DEFAULT, selected ? Typeface.BOLD : Typeface.NORMAL);
            button.setAllCaps(false);
            button.setGravity(Gravity.CENTER);
            button.setBackground(roundRect(selected ? ACCENT : Color.TRANSPARENT, dp(14), selected ? ACCENT : Color.TRANSPARENT));
            button.setContentDescription(section.label() + (selected ? "，当前页面" : ""));
            button.setOnClickListener(v -> {
                state.select(section);
                renderSection();
            });
            navigation.addView(button, new LinearLayout.LayoutParams(0, -1, 1f));
        }
    }

    private void addStage(LinearLayout parent, String number, String label, boolean active) {
        TextView stage = text(number + "  " + label, 12, active ? Color.WHITE : MUTED, active);
        stage.setGravity(Gravity.CENTER);
        stage.setBackground(roundRect(active ? ACCENT : SURFACE, dp(12), active ? ACCENT : STROKE));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(40), 1f);
        if (parent.getChildCount() > 0) params.leftMargin = dp(7);
        parent.addView(stage, params);
    }

    private void addPlatform(LinearLayout parent, String key, String mark, String label, int color) {
        LinearLayout item = new LinearLayout(this);
        item.setOrientation(LinearLayout.VERTICAL);
        item.setGravity(Gravity.CENTER);
        boolean selected = key.equals(selectedPlatform);
        item.setBackground(roundRect(selected ? SURFACE_2 : Color.TRANSPARENT, dp(14), selected ? ACCENT : Color.TRANSPARENT));
        item.setContentDescription("选择 " + label + (selected ? "，当前平台" : ""));
        item.setOnClickListener(v -> {
            selectedPlatform = key;
            renderSection();
        });
        TextView icon = text(mark, 17, Color.WHITE, true);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(roundRect(color, dp(13), color));
        item.addView(icon, new LinearLayout.LayoutParams(dp(42), dp(42)));
        TextView name = text(label, 11, MUTED, false);
        LinearLayout.LayoutParams nameParams = wrap();
        nameParams.topMargin = dp(6);
        item.addView(name, nameParams);
        parent.addView(item, new LinearLayout.LayoutParams(0, dp(72), 1f));
    }

    private TextView pill(String value, int foreground, int background) {
        TextView view = text(value, 12, foreground, true);
        view.setGravity(Gravity.CENTER);
        view.setBackground(roundRect(background, dp(17), STROKE));
        return view;
    }

    private Button action(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(15);
        button.setTextColor(Color.WHITE);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setBackground(roundRect(ACCENT, dp(15), ACCENT));
        return button;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
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

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}

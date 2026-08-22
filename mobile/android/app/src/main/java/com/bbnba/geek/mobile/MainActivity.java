package com.bbnba.geek.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Space;
import android.widget.TextView;

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
    private LinearLayout content;
    private LinearLayout navigation;
    private SharedPreferences accounts;
    private String selectedPlatform;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        accounts = getSharedPreferences("accounts", MODE_PRIVATE);
        selectedPlatform = accounts.getString("last_platform", "whatsapp");
        setContentView(buildShell());
        renderSection();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (accounts != null && content != null) {
            selectedPlatform = accounts.getString("last_platform", selectedPlatform);
            renderSection();
        }
    }

    private View buildShell() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(dp(18), dp(10), dp(18), dp(10));

        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1f));

        navigation = new LinearLayout(this);
        navigation.setOrientation(LinearLayout.HORIZONTAL);
        navigation.setPadding(dp(4), dp(4), dp(4), dp(4));
        navigation.setBackground(roundRect(SURFACE, dp(18), STROKE));
        LinearLayout.LayoutParams navParams = new LinearLayout.LayoutParams(-1, dp(62));
        navParams.topMargin = dp(10);
        root.addView(navigation, navParams);
        return root;
    }

    private void renderSection() {
        content.removeAllViews();
        renderHeader();
        if (state.selected() == ShellState.Section.ACCOUNTS) renderAccounts();
        else if (state.selected() == ShellState.Section.CONVERSATIONS) renderConversations();
        else if (state.selected() == ShellState.Section.TOOLS) renderTools();
        else renderProfile();
        renderNavigation();
    }

    private void renderHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text(state.selected().label(), 27, TEXT, true));
        String subtitle = state.selected() == ShellState.Section.ACCOUNTS
                ? accountCount() + " 个本机会话"
                : sectionSubtitle(state.selected());
        TextView detail = text(subtitle, 12, MUTED, false);
        LinearLayout.LayoutParams detailParams = wrap();
        detailParams.topMargin = dp(2);
        copy.addView(detail, detailParams);
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));

        if (state.selected() == ShellState.Section.ACCOUNTS) {
            Button add = compactButton("＋ 添加", false);
            add.setOnClickListener(v -> showAddAccount());
            row.addView(add, new LinearLayout.LayoutParams(dp(96), dp(42)));
        } else {
            TextView local = pill("●  本机", GREEN, SURFACE_2);
            row.addView(local, new LinearLayout.LayoutParams(dp(86), dp(36)));
        }
        content.addView(row, new LinearLayout.LayoutParams(-1, dp(64)));
    }

    private void renderAccounts() {
        if (hasCurrentSession()) renderAccountCard();
        else renderEmptyAccount();

        TextView quickTitle = text("常用功能", 16, TEXT, true);
        LinearLayout.LayoutParams quickTitleParams = wrap();
        quickTitleParams.topMargin = dp(22);
        content.addView(quickTitle, quickTitleParams);

        LinearLayout quick = new LinearLayout(this);
        quick.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams quickParams = matchWrap();
        quickParams.topMargin = dp(10);
        content.addView(quick, quickParams);
        addQuickTool(quick, "译", "翻译", "登录稳定后开放");
        addQuickTool(quick, "发", "群发", "多账号后开放");

        TextView safety = text("账号数据仅保存在这台手机的极客 App 沙箱中", 11, MUTED, false);
        safety.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams safetyParams = new LinearLayout.LayoutParams(-1, -2);
        safetyParams.topMargin = dp(18);
        content.addView(safety, safetyParams);
    }

    private void renderAccountCard() {
        LinearLayout card = card();
        LinearLayout.LayoutParams cardParams = matchWrap();
        cardParams.topMargin = dp(14);
        content.addView(card, cardParams);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        int platformColor = platformColor(selectedPlatform);
        TextView icon = text(platformMark(selectedPlatform), 20, Color.WHITE, true);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(roundRect(platformColor, dp(17), platformColor));
        top.addView(icon, new LinearLayout.LayoutParams(dp(54), dp(54)));

        LinearLayout identity = new LinearLayout(this);
        identity.setOrientation(LinearLayout.VERTICAL);
        identity.setPadding(dp(14), 0, 0, 0);
        identity.addView(text(browserRuntime.displayName(selectedPlatform), 18, TEXT, true));
        TextView local = text("本机会话 · 已保存", 12, MUTED, false);
        LinearLayout.LayoutParams localParams = wrap();
        localParams.topMargin = dp(3);
        identity.addView(local, localParams);
        top.addView(identity, new LinearLayout.LayoutParams(0, -2, 1f));

        TextView status = pill("●  可用", GREEN, SURFACE_2);
        top.addView(status, new LinearLayout.LayoutParams(dp(76), dp(34)));
        card.addView(top, matchWrap());

        TextView hint = text("直接回到会话，不需要重新登录", 13, MUTED, false);
        LinearLayout.LayoutParams hintParams = wrap();
        hintParams.topMargin = dp(17);
        card.addView(hint, hintParams);

        Button open = compactButton("打开 " + browserRuntime.displayName(selectedPlatform), true);
        open.setOnClickListener(v -> openAccount(selectedPlatform));
        LinearLayout.LayoutParams openParams = new LinearLayout.LayoutParams(-1, dp(50));
        openParams.topMargin = dp(16);
        card.addView(open, openParams);
    }

    private void renderEmptyAccount() {
        LinearLayout card = card();
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(245));
        params.topMargin = dp(14);
        content.addView(card, params);
        card.addView(text("连接第一个账号", 20, TEXT, true));
        TextView hint = text("选择平台后在当前 App 内完成登录", 13, MUTED, false);
        LinearLayout.LayoutParams hintParams = wrap();
        hintParams.topMargin = dp(7);
        card.addView(hint, hintParams);
        LinearLayout choices = platformChoices();
        LinearLayout.LayoutParams choiceParams = matchWrap();
        choiceParams.topMargin = dp(18);
        card.addView(choices, choiceParams);
        Button connect = compactButton("继续", true);
        connect.setOnClickListener(v -> openAccount(selectedPlatform));
        LinearLayout.LayoutParams connectParams = new LinearLayout.LayoutParams(-1, dp(48));
        connectParams.topMargin = dp(18);
        card.addView(connect, connectParams);
    }

    private void showAddAccount() {
        if (hasCurrentSession()) {
            android.widget.Toast.makeText(this, "多账号隔离正在下一阶段开发", android.widget.Toast.LENGTH_SHORT).show();
            return;
        }
        renderSection();
    }

    private void renderConversations() {
        LinearLayout card = card();
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, 0, 1f);
        params.topMargin = dp(14);
        content.addView(card, params);
        if (hasCurrentSession()) {
            card.addView(text("继续最近会话", 18, TEXT, true));
            TextView note = text(browserRuntime.displayName(selectedPlatform) + " 会话保存在当前设备", 13, MUTED, false);
            LinearLayout.LayoutParams noteParams = wrap();
            noteParams.topMargin = dp(7);
            card.addView(note, noteParams);
            Space space = new Space(this);
            card.addView(space, new LinearLayout.LayoutParams(1, 0, 1f));
            Button open = compactButton("打开会话", true);
            open.setOnClickListener(v -> openAccount(selectedPlatform));
            card.addView(open, new LinearLayout.LayoutParams(-1, dp(50)));
        } else {
            card.setGravity(Gravity.CENTER);
            card.addView(text("先在“账号”里连接一个平台", 14, MUTED, false));
        }
    }

    private void renderTools() {
        TextView guide = text("工具按安全顺序开放", 15, MUTED, false);
        LinearLayout.LayoutParams guideParams = wrap();
        guideParams.topMargin = dp(14);
        content.addView(guide, guideParams);
        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        listParams.topMargin = dp(12);
        content.addView(list, listParams);
        addToolRow(list, "多账号", "隔离每个账号的登录和数据", "下一步");
        addToolRow(list, "翻译", "发送前翻译并校验输出", "待开发");
        addToolRow(list, "群发", "可暂停、可停止、避免重复发送", "待开发");
    }

    private void renderProfile() {
        LinearLayout card = card();
        LinearLayout.LayoutParams params = matchWrap();
        params.topMargin = dp(14);
        content.addView(card, params);
        card.addView(text("当前设备", 16, TEXT, true));
        addInfoRow(card, "设备", "Mblu 21");
        addInfoRow(card, "数据位置", "仅本机 App 沙箱");
        addInfoRow(card, "版本", "0.1.0 测试版");
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

    private LinearLayout platformChoices() {
        LinearLayout choices = new LinearLayout(this);
        choices.setOrientation(LinearLayout.HORIZONTAL);
        addPlatformChoice(choices, "whatsapp", "W");
        addPlatformChoice(choices, "telegram", "T");
        addPlatformChoice(choices, "line", "L");
        return choices;
    }

    private void addPlatformChoice(LinearLayout parent, String key, String mark) {
        boolean selected = key.equals(selectedPlatform);
        Button button = compactButton(mark + "  " + browserRuntime.displayName(key), selected);
        button.setContentDescription("选择 " + browserRuntime.displayName(key));
        button.setOnClickListener(v -> {
            selectedPlatform = key;
            renderSection();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(46), 1f);
        if (parent.getChildCount() > 0) params.leftMargin = dp(7);
        parent.addView(button, params);
    }

    private void addQuickTool(LinearLayout parent, String mark, String title, String subtitle) {
        LinearLayout item = new LinearLayout(this);
        item.setOrientation(LinearLayout.VERTICAL);
        item.setPadding(dp(15), dp(14), dp(15), dp(14));
        item.setBackground(roundRect(SURFACE, dp(17), STROKE));
        item.addView(text(mark + "  " + title, 15, TEXT, true));
        TextView detail = text(subtitle, 11, MUTED, false);
        LinearLayout.LayoutParams detailParams = wrap();
        detailParams.topMargin = dp(7);
        item.addView(detail, detailParams);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(90), 1f);
        if (parent.getChildCount() > 0) params.leftMargin = dp(9);
        parent.addView(item, params);
    }

    private void addToolRow(LinearLayout parent, String title, String subtitle, String stateText) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(17), dp(15), dp(17), dp(15));
        row.setBackground(roundRect(SURFACE, dp(17), STROKE));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text(title, 16, TEXT, true));
        TextView detail = text(subtitle, 12, MUTED, false);
        LinearLayout.LayoutParams detailParams = wrap();
        detailParams.topMargin = dp(4);
        copy.addView(detail, detailParams);
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(pill(stateText, "下一步".equals(stateText) ? ACCENT : MUTED, SURFACE_2), new LinearLayout.LayoutParams(dp(72), dp(34)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(82));
        if (parent.getChildCount() > 0) params.topMargin = dp(10);
        parent.addView(row, params);
    }

    private void addInfoRow(LinearLayout parent, String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(14), 0, 0);
        row.addView(text(label, 13, MUTED, false), new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(text(value, 13, TEXT, false));
        parent.addView(row, matchWrap());
    }

    private void openAccount(String platform) {
        accounts.edit().putString("last_platform", platform).apply();
        Intent intent = new Intent(this, AccountSetupActivity.class);
        intent.putExtra(AccountSetupActivity.EXTRA_PLATFORM, platform);
        startActivity(intent);
    }

    private boolean hasCurrentSession() {
        return accounts.getBoolean("session_created_" + selectedPlatform, false);
    }

    private int accountCount() {
        return hasCurrentSession() ? 1 : 0;
    }

    private String sectionSubtitle(ShellState.Section section) {
        if (section == ShellState.Section.CONVERSATIONS) return "快速返回平台会话";
        if (section == ShellState.Section.TOOLS) return "多账号、翻译与群发";
        return "设备、安全与版本";
    }

    private String platformMark(String platform) {
        if ("telegram".equals(platform)) return "T";
        if ("line".equals(platform)) return "L";
        return "W";
    }

    private int platformColor(String platform) {
        if ("telegram".equals(platform)) return Color.rgb(51, 144, 236);
        if ("line".equals(platform)) return Color.rgb(6, 199, 85);
        return Color.rgb(37, 211, 102);
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(roundRect(SURFACE, dp(19), STROKE));
        return card;
    }

    private Button compactButton(String label, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(13);
        button.setTextColor(primary ? Color.WHITE : TEXT);
        button.setTypeface(Typeface.DEFAULT, primary ? Typeface.BOLD : Typeface.NORMAL);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setBackground(roundRect(primary ? ACCENT : SURFACE_2, dp(14), primary ? ACCENT : STROKE));
        return button;
    }

    private TextView pill(String value, int foreground, int background) {
        TextView view = text(value, 11, foreground, true);
        view.setGravity(Gravity.CENTER);
        view.setBackground(roundRect(background, dp(17), STROKE));
        return view;
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

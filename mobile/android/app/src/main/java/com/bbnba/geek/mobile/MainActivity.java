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

    private final ShellState shellState = new ShellState();
    private final BrowserRuntime browserRuntime = new WebBrowserRuntime();
    private SharedPreferences accounts;
    private LinearLayout content;
    private LinearLayout navigation;
    private String selectedPlatform;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        accounts = getSharedPreferences("accounts", MODE_PRIVATE);
        selectedPlatform = accounts.getString("last_platform", "whatsapp");
        if (!hasAnySession()) shellState.select(ShellState.Section.APPLICATIONS);
        setContentView(buildShell());
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (accounts != null && content != null) {
            selectedPlatform = accounts.getString("last_platform", selectedPlatform);
            if (hasAnySession() && shellState.selected() == ShellState.Section.APPLICATIONS) {
                shellState.select(ShellState.Section.ACCOUNTS);
            }
            render();
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
        LinearLayout.LayoutParams navParams = new LinearLayout.LayoutParams(-1, dp(64));
        navParams.topMargin = dp(10);
        root.addView(navigation, navParams);
        return root;
    }

    private void render() {
        content.removeAllViews();
        renderHeader();
        if (shellState.selected() == ShellState.Section.APPLICATIONS) renderApplicationCenter();
        else if (shellState.selected() == ShellState.Section.ACCOUNTS) renderAccountList();
        else renderProfile();
        renderNavigation();
    }

    private void renderHeader() {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text(shellState.selected().label(), 27, TEXT, true));
        TextView subtitle = text(sectionSubtitle(), 12, MUTED, false);
        LinearLayout.LayoutParams subtitleParams = wrap();
        subtitleParams.topMargin = dp(2);
        copy.addView(subtitle, subtitleParams);
        row.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));

        if (shellState.selected() == ShellState.Section.ACCOUNTS) {
            Button add = compactButton("＋ 添加", false);
            add.setOnClickListener(v -> {
                shellState.select(ShellState.Section.APPLICATIONS);
                render();
            });
            row.addView(add, new LinearLayout.LayoutParams(dp(96), dp(42)));
        } else {
            TextView local = pill("●  本机", GREEN, SURFACE_2);
            row.addView(local, new LinearLayout.LayoutParams(dp(86), dp(36)));
        }
        content.addView(row, new LinearLayout.LayoutParams(-1, dp(66)));
    }

    private void renderApplicationCenter() {
        TextView intro = text("选择应用，登录后自动加入账户列表", 14, MUTED, false);
        LinearLayout.LayoutParams introParams = wrap();
        introParams.topMargin = dp(12);
        content.addView(intro, introParams);

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        listParams.topMargin = dp(16);
        content.addView(list, listParams);
        addApplication(list, "whatsapp", "WhatsApp", "聊天与客户沟通", Color.rgb(37, 211, 102));
        addApplication(list, "telegram", "Telegram", "频道、群组与私聊", Color.rgb(51, 144, 236));
        addApplication(list, "line", "LINE", "好友与商业会话", Color.rgb(6, 199, 85));

        TextView note = text("与 PC 端一致：每次添加都会成为一个独立账户实例", 11, MUTED, false);
        note.setGravity(Gravity.CENTER);
        content.addView(note, new LinearLayout.LayoutParams(-1, dp(38)));
    }

    private void addApplication(LinearLayout parent, String platform, String title, String description, int color) {
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(16), dp(14), dp(14), dp(14));
        card.setBackground(roundRect(SURFACE, dp(18), STROKE));

        TextView icon = text(platformMark(platform), 20, Color.WHITE, true);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(roundRect(color, dp(16), color));
        card.addView(icon, new LinearLayout.LayoutParams(dp(54), dp(54)));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.setPadding(dp(14), 0, dp(8), 0);
        copy.addView(text(title, 17, TEXT, true));
        TextView detail = text(description, 12, MUTED, false);
        LinearLayout.LayoutParams detailParams = wrap();
        detailParams.topMargin = dp(4);
        copy.addView(detail, detailParams);
        card.addView(copy, new LinearLayout.LayoutParams(0, -2, 1f));

        Button add = compactButton(hasSession(platform) ? "再添加" : "添加", true);
        add.setContentDescription("添加 " + title + " 账户");
        add.setOnClickListener(v -> requestAccount(platform));
        card.addView(add, new LinearLayout.LayoutParams(dp(84), dp(44)));

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(88));
        if (parent.getChildCount() > 0) params.topMargin = dp(11);
        parent.addView(card, params);
    }

    private void requestAccount(String platform) {
        if (hasSession(platform)) {
            Toast.makeText(this, "正在接入第 2 个隔离实例，当前先打开已有账户", Toast.LENGTH_SHORT).show();
        }
        selectedPlatform = platform;
        openAccount(platform);
    }

    private void renderAccountList() {
        if (!hasAnySession()) {
            LinearLayout empty = card();
            empty.setGravity(Gravity.CENTER);
            empty.addView(text("还没有账户", 19, TEXT, true));
            TextView hint = text("去应用中心选择 WhatsApp、Telegram 或 LINE", 13, MUTED, false);
            LinearLayout.LayoutParams hintParams = wrap();
            hintParams.topMargin = dp(8);
            empty.addView(hint, hintParams);
            Button go = compactButton("打开应用中心", true);
            go.setOnClickListener(v -> {
                shellState.select(ShellState.Section.APPLICATIONS);
                render();
            });
            LinearLayout.LayoutParams goParams = new LinearLayout.LayoutParams(-1, dp(48));
            goParams.topMargin = dp(20);
            empty.addView(go, goParams);
            LinearLayout.LayoutParams emptyParams = new LinearLayout.LayoutParams(-1, dp(260));
            emptyParams.topMargin = dp(16);
            content.addView(empty, emptyParams);
            return;
        }

        TextView count = text(accountCount() + " 个账户 · 点击进入对应的多开实例", 13, MUTED, false);
        LinearLayout.LayoutParams countParams = wrap();
        countParams.topMargin = dp(12);
        content.addView(count, countParams);

        LinearLayout list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        listParams.topMargin = dp(14);
        content.addView(list, listParams);
        if (hasSession("whatsapp")) addAccountRow(list, "whatsapp", accountName("whatsapp"));
        if (hasSession("telegram")) addAccountRow(list, "telegram", accountName("telegram"));
        if (hasSession("line")) addAccountRow(list, "line", accountName("line"));
    }

    private void addAccountRow(LinearLayout parent, String platform, String name) {
        LinearLayout card = new LinearLayout(this);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(16), dp(15), dp(14), dp(15));
        card.setBackground(roundRect(SURFACE, dp(18), STROKE));
        TextView icon = text(platformMark(platform), 19, Color.WHITE, true);
        icon.setGravity(Gravity.CENTER);
        icon.setBackground(roundRect(platformColor(platform), dp(16), platformColor(platform)));
        card.addView(icon, new LinearLayout.LayoutParams(dp(54), dp(54)));

        LinearLayout identity = new LinearLayout(this);
        identity.setOrientation(LinearLayout.VERTICAL);
        identity.setPadding(dp(14), 0, 0, 0);
        identity.addView(text(name, 17, TEXT, true));
        TextView state = text("● 在线 · 本机独立会话", 12, GREEN, false);
        LinearLayout.LayoutParams stateParams = wrap();
        stateParams.topMargin = dp(4);
        identity.addView(state, stateParams);
        card.addView(identity, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView arrow = text("›", 29, MUTED, false);
        arrow.setGravity(Gravity.CENTER);
        card.addView(arrow, new LinearLayout.LayoutParams(dp(38), dp(48)));
        card.setContentDescription("打开账户 " + name);
        card.setOnClickListener(v -> openAccount(platform));

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, dp(94));
        if (parent.getChildCount() > 0) params.topMargin = dp(11);
        parent.addView(card, params);
    }

    private void renderProfile() {
        LinearLayout card = card();
        LinearLayout.LayoutParams params = matchWrap();
        params.topMargin = dp(16);
        content.addView(card, params);
        card.addView(text("当前设备", 17, TEXT, true));
        addInfoRow(card, "设备", "Mblu 21");
        addInfoRow(card, "账户数据", "仅保存在 App 沙箱");
        addInfoRow(card, "版本", "0.1.0 测试版");
    }

    private void renderNavigation() {
        navigation.removeAllViews();
        for (ShellState.Section section : ShellState.Section.values()) {
            boolean selected = shellState.selected() == section;
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
                shellState.select(section);
                render();
            });
            navigation.addView(button, new LinearLayout.LayoutParams(0, -1, 1f));
        }
    }

    private void openAccount(String platform) {
        accounts.edit().putString("last_platform", platform).apply();
        Intent intent = new Intent(this, AccountSetupActivity.class);
        intent.putExtra(AccountSetupActivity.EXTRA_PLATFORM, platform);
        intent.putExtra(AccountSetupActivity.EXTRA_ACCOUNT_NAME, accountName(platform));
        startActivity(intent);
    }

    private boolean hasAnySession() {
        return hasSession("whatsapp") || hasSession("telegram") || hasSession("line");
    }

    private boolean hasSession(String platform) {
        return accounts.getBoolean("session_created_" + platform, false);
    }

    private int accountCount() {
        int count = 0;
        if (hasSession("whatsapp")) count++;
        if (hasSession("telegram")) count++;
        if (hasSession("line")) count++;
        return count;
    }

    private String accountName(String platform) {
        return accounts.getString("account_name_" + platform, browserRuntime.displayName(platform) + " 1");
    }

    private String sectionSubtitle() {
        if (shellState.selected() == ShellState.Section.APPLICATIONS) return "选择并添加聊天应用";
        if (shellState.selected() == ShellState.Section.ACCOUNTS) return accountCount() + " 个多开账户";
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

    private void addInfoRow(LinearLayout parent, String label, String value) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(15), 0, 0);
        row.addView(text(label, 13, MUTED, false), new LinearLayout.LayoutParams(0, -2, 1f));
        row.addView(text(value, 13, TEXT, false));
        parent.addView(row, matchWrap());
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

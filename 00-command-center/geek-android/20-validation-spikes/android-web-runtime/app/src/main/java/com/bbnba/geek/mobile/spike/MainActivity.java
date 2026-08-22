package com.bbnba.geek.mobile.spike;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Space;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(11, 13, 18);
    private static final int SURFACE = Color.rgb(20, 24, 33);
    private static final int TEXT = Color.rgb(241, 244, 249);
    private static final int MUTED = Color.rgb(143, 151, 169);
    private static final int ACCENT = Color.rgb(124, 92, 255);
    private String selectedPlatform = "whatsapp";
    private LinearLayout platformRow;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        setContentView(buildContent());
    }

    private View buildContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(20), dp(20), dp(20));
        root.setBackgroundColor(BG);

        TextView eyebrow = text("GEEK · ANDROID", 12, ACCENT, true);
        root.addView(eyebrow);

        TextView title = text("极客移动端", 28, TEXT, true);
        LinearLayout.LayoutParams titleParams = wrap();
        titleParams.topMargin = dp(8);
        root.addView(title, titleParams);

        TextView subtitle = text("第一阶段 · App 外壳与单账号内核验证", 14, MUTED, false);
        LinearLayout.LayoutParams subtitleParams = wrap();
        subtitleParams.topMargin = dp(6);
        root.addView(subtitle, subtitleParams);

        platformRow = new LinearLayout(this);
        platformRow.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams rowParams = matchWrap();
        rowParams.topMargin = dp(24);
        root.addView(platformRow, rowParams);
        rebuildPlatforms();

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(22), dp(28), dp(22), dp(28));
        card.setBackground(roundRect(SURFACE, dp(18), Color.rgb(40, 46, 60)));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, 0, 1f);
        cardParams.topMargin = dp(18);
        cardParams.bottomMargin = dp(18);
        root.addView(card, cardParams);

        TextView badge = text("＋", 30, ACCENT, false);
        badge.setGravity(Gravity.CENTER);
        card.addView(badge, new LinearLayout.LayoutParams(dp(56), dp(56)));

        TextView emptyTitle = text("还没有移动端账号", 19, TEXT, true);
        LinearLayout.LayoutParams emptyTitleParams = wrap();
        emptyTitleParams.topMargin = dp(18);
        card.addView(emptyTitle, emptyTitleParams);

        TextView emptyBody = text("先验证一个账号能否稳定登录、收发和重启恢复，\n通过后再进入真正的多开。", 14, MUTED, false);
        emptyBody.setGravity(Gravity.CENTER);
        emptyBody.setLineSpacing(0, 1.2f);
        LinearLayout.LayoutParams emptyBodyParams = wrap();
        emptyBodyParams.topMargin = dp(10);
        card.addView(emptyBody, emptyBodyParams);

        Space spacer = new Space(this);
        card.addView(spacer, new LinearLayout.LayoutParams(1, 0, 1f));

        TextView note = text("验证代码不会进入正式移动端", 12, MUTED, false);
        card.addView(note);

        Button open = button("打开单账号验证", true);
        open.setOnClickListener(v -> {
            Intent intent = new Intent(this, ProbeActivity.class);
            intent.putExtra("platform", selectedPlatform);
            startActivity(intent);
        });
        root.addView(open, new LinearLayout.LayoutParams(-1, dp(52)));

        return root;
    }

    private void rebuildPlatforms() {
        platformRow.removeAllViews();
        addPlatform("whatsapp", "WhatsApp");
        addPlatform("telegram", "Telegram");
        addPlatform("line", "LINE");
    }

    private void addPlatform(String key, String label) {
        Button item = button(label, key.equals(selectedPlatform));
        item.setContentDescription("选择 " + label + " 平台");
        item.setOnClickListener(v -> {
            selectedPlatform = key;
            rebuildPlatforms();
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, dp(48), 1f);
        if (platformRow.getChildCount() > 0) params.leftMargin = dp(8);
        platformRow.addView(item, params);
    }

    private Button button(String label, boolean primary) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextSize(14);
        button.setTextColor(primary ? Color.WHITE : MUTED);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(48));
        button.setBackground(roundRect(primary ? ACCENT : SURFACE, dp(13), primary ? ACCENT : Color.rgb(46, 52, 67)));
        return button;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private GradientDrawable roundRect(int fill, int radius, int stroke) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(fill);
        drawable.setCornerRadius(radius);
        drawable.setStroke(dp(1), stroke);
        return drawable;
    }

    private LinearLayout.LayoutParams wrap() { return new LinearLayout.LayoutParams(-2, -2); }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(-1, -2); }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}

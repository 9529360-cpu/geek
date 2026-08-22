package com.bbnba.geek.mobile.translation;

import android.content.Context;
import android.content.SharedPreferences;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

public final class TranslationSettingsStore {
    private final SharedPreferences preferences;

    public TranslationSettingsStore(Context context, String accountScope) {
        preferences = context.getSharedPreferences("translation_" + safeScope(accountScope), Context.MODE_PRIVATE);
    }

    public GlobalConfig global() {
        return new GlobalConfig(
                preferences.getBoolean("global_receive_auto", true),
                preferences.getString("global_receive_target", "zh"),
                preferences.getBoolean("global_group_auto", false),
                preferences.getBoolean("global_send_enabled", false),
                preferences.getString("global_send_source", "auto"),
                preferences.getString("global_send_target", "en"),
                preferences.getBoolean("global_manual", true));
    }

    public void saveGlobal(GlobalConfig config) {
        preferences.edit()
                .putBoolean("global_receive_auto", config.receiveAuto())
                .putString("global_receive_target", config.receiveTarget())
                .putBoolean("global_group_auto", config.groupAuto())
                .putBoolean("global_send_enabled", config.sendEnabled())
                .putString("global_send_source", config.sendSource())
                .putString("global_send_target", config.sendTarget())
                .putBoolean("global_manual", config.manualTranslation())
                .apply();
    }

    public ChatConfig chat(String chatId) {
        String prefix = chatPrefix(chatId);
        boolean override = preferences.getBoolean(prefix + "override", false);
        GlobalConfig global = global();
        return new ChatConfig(
                override,
                preferences.getBoolean(prefix + "receive_auto", global.receiveAuto()),
                preferences.getString(prefix + "receive_target", global.receiveTarget()),
                preferences.getBoolean(prefix + "send_enabled", global.sendEnabled()),
                preferences.getString(prefix + "send_target", global.sendTarget()),
                preferences.getBoolean(prefix + "manual", global.manualTranslation()));
    }

    public void saveChat(String chatId, ChatConfig config) {
        String prefix = chatPrefix(chatId);
        preferences.edit()
                .putBoolean(prefix + "override", config.overrideEnabled())
                .putBoolean(prefix + "receive_auto", config.receiveAuto())
                .putString(prefix + "receive_target", config.receiveTarget())
                .putBoolean(prefix + "send_enabled", config.sendEnabled())
                .putString(prefix + "send_target", config.sendTarget())
                .putBoolean(prefix + "manual", config.manualTranslation())
                .apply();
    }

    public void resetChat(String chatId) {
        String prefix = chatPrefix(chatId);
        preferences.edit()
                .remove(prefix + "override")
                .remove(prefix + "receive_auto")
                .remove(prefix + "receive_target")
                .remove(prefix + "send_enabled")
                .remove(prefix + "send_target")
                .remove(prefix + "manual")
                .apply();
    }

    public static String chatScopeKey(String chatId) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(String.valueOf(chatId).getBytes(StandardCharsets.UTF_8));
            StringBuilder key = new StringBuilder();
            for (int i = 0; i < 12; i++) key.append(String.format("%02x", hash[i]));
            return key.toString();
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static String chatPrefix(String chatId) {
        return "chat_" + chatScopeKey(chatId) + "_";
    }

    private static String safeScope(String value) {
        return String.valueOf(value).replaceAll("[^a-zA-Z0-9_-]", "_");
    }

    public record GlobalConfig(
            boolean receiveAuto,
            String receiveTarget,
            boolean groupAuto,
            boolean sendEnabled,
            String sendSource,
            String sendTarget,
            boolean manualTranslation) {}

    public record ChatConfig(
            boolean overrideEnabled,
            boolean receiveAuto,
            String receiveTarget,
            boolean sendEnabled,
            String sendTarget,
            boolean manualTranslation) {}
}

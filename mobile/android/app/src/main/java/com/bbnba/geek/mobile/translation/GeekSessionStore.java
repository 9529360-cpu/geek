package com.bbnba.geek.mobile.translation;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

public final class GeekSessionStore {
    private static final String KEY_ALIAS = "geek_mobile_product_session_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private final SharedPreferences preferences;

    public GeekSessionStore(Context context) {
        preferences = context.getSharedPreferences("geek_product_session", Context.MODE_PRIVATE);
    }

    public void save(Session session) {
        try {
            preferences.edit()
                    .putString("token", encrypt(session.token()))
                    .putString("email", session.email())
                    .putLong("user_id", session.userId())
                    .putLong("remaining_chars", session.remainingChars())
                    .apply();
        } catch (Exception error) {
            clear();
            throw new IllegalStateException("系统安全存储不可用，未保存登录令牌", error);
        }
    }

    public Session load() {
        String encoded = preferences.getString("token", "");
        if (encoded == null || encoded.isEmpty()) return null;
        try {
            String token = decrypt(encoded);
            if (token.isEmpty()) return null;
            return new Session(
                    token,
                    preferences.getString("email", ""),
                    preferences.getLong("user_id", 0),
                    preferences.getLong("remaining_chars", 0));
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    public void updateQuota(long remainingChars) {
        preferences.edit().putLong("remaining_chars", Math.max(0, remainingChars)).apply();
    }

    public void clear() {
        preferences.edit().clear().apply();
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, secretKey());
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        ByteBuffer payload = ByteBuffer.allocate(4 + iv.length + encrypted.length);
        payload.putInt(iv.length).put(iv).put(encrypted);
        return Base64.encodeToString(payload.array(), Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        ByteBuffer payload = ByteBuffer.wrap(Base64.decode(value, Base64.NO_WRAP));
        int ivLength = payload.getInt();
        if (ivLength < 12 || ivLength > 16 || payload.remaining() <= ivLength) throw new IllegalArgumentException("invalid session payload");
        byte[] iv = new byte[ivLength];
        payload.get(iv);
        byte[] encrypted = new byte[payload.remaining()];
        payload.get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    private SecretKey secretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(ANDROID_KEYSTORE);
        keyStore.load(null);
        SecretKey existing = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    public record Session(String token, String email, long userId, long remainingChars) {}
}

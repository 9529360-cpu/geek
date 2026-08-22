package com.bbnba.geek.mobile.translation;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

public final class GeekTranslationClient {
    public static final String SUBSCRIPTION_ORIGIN = "https://geek-subscription.9529360.workers.dev";
    public static final String TRANSLATION_ORIGIN = "https://geek-translate.9529360.workers.dev";
    private static final ExecutorService NETWORK = Executors.newFixedThreadPool(2);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private final GeekSessionStore sessionStore;
    private volatile TranslationToken translationToken;

    public GeekTranslationClient(GeekSessionStore sessionStore) {
        this.sessionStore = sessionStore;
    }

    public void login(String email, String password, Callback<GeekSessionStore.Session> callback) {
        NETWORK.execute(() -> complete(callback, () -> {
            JSONObject body = new JSONObject().put("email", email.trim()).put("password", password);
            JSONObject result = request(SUBSCRIPTION_ORIGIN + "/api/login", "", body);
            JSONObject user = result.getJSONObject("user");
            GeekSessionStore.Session session = new GeekSessionStore.Session(
                    result.getString("token"),
                    user.optString("email", email.trim()),
                    user.optLong("id", 0),
                    0);
            sessionStore.save(session);
            return session;
        }));
    }

    public void translate(String text, String source, String target, Callback<TranslationResult> callback) {
        NETWORK.execute(() -> complete(callback, () -> {
            GeekSessionStore.Session session = sessionStore.load();
            if (session == null) throw new ServiceException("LOGIN_REQUIRED", "请先登录极客账号");
            String bearer = translationBearer(session.token());
            JSONObject body = new JSONObject()
                    .put("text", text)
                    .put("source", source == null || source.isEmpty() ? "auto" : source)
                    .put("target", target)
                    .put("provider", "auto")
                    .put("route", "default");
            JSONObject result = request(TRANSLATION_ORIGIN + "/v1/translate", bearer, body);
            TranslationOutputSafety.Assessment safe = TranslationOutputSafety.assess(text, result.optString("text", ""), target);
            if (!safe.safe()) throw new ServiceException(safe.reason(), "译文安全校验未通过，已禁止发送");
            return new TranslationResult(safe.text(), result.optString("source", source), result.optString("target", target));
        }));
    }

    private String translationBearer(String productToken) throws Exception {
        long now = System.currentTimeMillis() / 1000;
        TranslationToken cached = translationToken;
        if (cached != null && cached.expiresAt() > now + 30) return cached.value();
        JSONObject result = request(SUBSCRIPTION_ORIGIN + "/api/translation-token", productToken, new JSONObject());
        String value = result.optString("token", "");
        long expiresAt = result.optLong("expires_at", 0);
        if (value.isEmpty() || expiresAt <= now) throw new ServiceException("INVALID_TRANSLATION_TOKEN", "翻译授权返回格式错误");
        translationToken = new TranslationToken(value, expiresAt);
        return value;
    }

    private JSONObject request(String endpoint, String bearer, JSONObject body) throws Exception {
        URL url = new URL(endpoint);
        if (!"https".equals(url.getProtocol()) || (!SUBSCRIPTION_ORIGIN.equals(url.getProtocol() + "://" + url.getHost())
                && !TRANSLATION_ORIGIN.equals(url.getProtocol() + "://" + url.getHost()))) {
            throw new ServiceException("UNSAFE_ENDPOINT", "服务地址未通过安全校验");
        }
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(10_000);
        connection.setReadTimeout(30_000);
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("X-Geek-Client", "android-1");
        connection.setRequestProperty("X-Request-ID", UUID.randomUUID().toString());
        if (bearer != null && !bearer.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + bearer);
        byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(payload.length);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(payload);
        }
        int status = connection.getResponseCode();
        JSONObject response = readJson(status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream());
        connection.disconnect();
        if (status < 200 || status >= 300) {
            String code = response.optString("error", "HTTP_" + status);
            throw new ServiceException(code, userMessage(code, status));
        }
        return response;
    }

    private JSONObject readJson(InputStream stream) throws Exception {
        if (stream == null) return new JSONObject();
        StringBuilder value = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) value.append(line);
        }
        return value.length() == 0 ? new JSONObject() : new JSONObject(value.toString());
    }

    private String userMessage(String code, int status) {
        if ("invalid_credentials".equals(code)) return "邮箱或密码不正确";
        if ("quota_exhausted".equals(code)) return "翻译额度已用完";
        if ("rate_limited".equals(code)) return "请求过于频繁，请稍后再试";
        if (status == 401) return "登录已失效，请重新登录";
        return "翻译服务暂时不可用";
    }

    private <T> void complete(Callback<T> callback, NetworkCall<T> call) {
        try {
            T value = call.run();
            MAIN.post(() -> callback.complete(value, null));
        } catch (Exception error) {
            MAIN.post(() -> callback.complete(null, error));
        }
    }

    public interface Callback<T> {
        void complete(T value, Exception error);
    }

    private interface NetworkCall<T> {
        T run() throws Exception;
    }

    public record TranslationResult(String text, String source, String target) {}
    private record TranslationToken(String value, long expiresAt) {}

    public static final class ServiceException extends Exception {
        private final String code;

        public ServiceException(String code, String message) {
            super(message);
            this.code = code;
        }

        public String code() {
            return code;
        }
    }
}

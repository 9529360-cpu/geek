package com.bbnba.geek.mobile.translation;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

public final class TranslationOutputSafety {
    private static final Set<String> LATIN_TARGETS = Set.of(
            "en", "it", "es", "fr", "de", "pt", "id", "pl", "tr", "vi", "nl", "sv");
    private static final Pattern[] META_PREFIXES = new Pattern[]{
            Pattern.compile("^(?:以下|下面)(?:是|为)?[^\\n：:]{0,30}(?:翻译|译文|翻译结果)(?:成|为|至)?[^\\n：:]{0,30}[：:]?\\s*", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^(?:翻译|译文|翻译结果)(?:成|为|至)?[^\\n：:]{0,30}[：:]\\s*", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^(?:here(?:'s| is)|below is|the following is)\\s+(?:the\\s+)?(?:translation|translated text)(?:\\s+(?:in|into|to)\\s+[^:\\n]{1,30})?[：:]?\\s*", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^(?:translation|translated text)(?:\\s+(?:in|into|to)\\s+[^:\\n]{1,30})?[：:]\\s*", Pattern.CASE_INSENSITIVE),
            Pattern.compile("^(?:sure|certainly|of course)[,!：:\\s-]*(?:here(?:'s| is)\\s+)?(?:the\\s+)?(?:translation|translated text)?(?:\\s+(?:in|into|to)\\s+[^:\\n]{1,30})?[：:]?\\s*", Pattern.CASE_INSENSITIVE)
    };
    private static final Pattern CJK = Pattern.compile("[\\u3400-\\u9fff]");
    private static final Pattern LATIN = Pattern.compile("[A-Za-zÀ-ÖØ-öø-ÿĀ-ž]");

    private TranslationOutputSafety() {}

    public static Assessment assess(String source, String rawOutput, String target) {
        String original = clean(source);
        String text = sanitize(rawOutput);
        String language = clean(target).toLowerCase(Locale.ROOT);
        if (text.isEmpty()) return Assessment.blocked("EMPTY_TRANSLATION", "");
        if (text.length() > Math.max(800, original.length() * 8 + 160)) {
            return Assessment.blocked("SUSPICIOUS_LENGTH", text);
        }

        int sourceCjk = count(CJK, original);
        int outputCjk = count(CJK, text);
        if (!"zh".equals(language) && sourceCjk > 0 && comparable(original).equals(comparable(text))) {
            return Assessment.blocked("UNCHANGED_SOURCE", text);
        }
        if (LATIN_TARGETS.contains(language) && sourceCjk >= 2) {
            int latinLetters = count(LATIN, text);
            if (latinLetters < 2 && outputCjk >= Math.max(2, (int) Math.ceil(sourceCjk * 0.5))) {
                return Assessment.blocked("TARGET_SCRIPT_MISMATCH", text);
            }
        }
        return Assessment.safe(text);
    }

    public static String sanitize(String value) {
        String text = stripFence(clean(value))
                .replaceFirst("(?is)^<think>.*?</think>\\s*", "")
                .replaceFirst("(?i)^(?:Here's a thinking process|Let me think|I'll translate|以下是思考过程|让我思考)[：:\\s]*", "")
                .trim();
        for (int pass = 0; pass < 3; pass++) {
            String before = text;
            for (Pattern pattern : META_PREFIXES) text = pattern.matcher(text).replaceFirst("").trim();
            if (before.equals(text)) break;
        }
        text = stripFence(text);
        if (text.length() >= 2 && ((text.startsWith("“") && text.endsWith("”"))
                || (text.startsWith("‘") && text.endsWith("’"))
                || (text.startsWith("\"") && text.endsWith("\""))
                || (text.startsWith("'") && text.endsWith("'")))) {
            text = text.substring(1, text.length() - 1).trim();
        }
        return text;
    }

    private static String stripFence(String value) {
        return value.replaceFirst("(?is)^```(?:[a-z-]+)?\\s*\\n?(.*?)\\n?```$", "$1").trim();
    }

    private static String comparable(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT)
                .replaceAll("[\\s\\p{P}\\p{S}]+", "");
    }

    private static int count(Pattern pattern, String value) {
        int total = 0;
        var matcher = pattern.matcher(value);
        while (matcher.find()) total++;
        return total;
    }

    private static String clean(String value) {
        return value == null ? "" : value.trim();
    }

    public record Assessment(boolean safe, String text, String reason) {
        private static Assessment safe(String text) {
            return new Assessment(true, text, "");
        }

        private static Assessment blocked(String reason, String text) {
            return new Assessment(false, text, reason);
        }
    }
}

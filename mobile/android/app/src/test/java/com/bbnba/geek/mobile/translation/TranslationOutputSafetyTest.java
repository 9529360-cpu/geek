package com.bbnba.geek.mobile.translation;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class TranslationOutputSafetyTest {
    private static final String SOURCE = "晚上好  你吃饭了吗";

    @Test
    public void removesModelPreambleAndKeepsOnlyItalianTranslation() {
        var result = TranslationOutputSafety.assess(
                SOURCE,
                "以下是意大利语翻译：\nBuonasera, hai già cenato?",
                "it");

        assertTrue(result.safe());
        assertEquals("Buonasera, hai già cenato?", result.text());
    }

    @Test
    public void blocksTheOriginalChineseTextReturnedAsItalian() {
        var result = TranslationOutputSafety.assess(
                SOURCE,
                "以下是意大利语翻译\n晚上好  你吃饭了吗",
                "it");

        assertFalse(result.safe());
        assertEquals("UNCHANGED_SOURCE", result.reason());
    }

    @Test
    public void blocksTargetScriptMismatchAndEmptyOutput() {
        assertEquals("TARGET_SCRIPT_MISMATCH",
                TranslationOutputSafety.assess(SOURCE, "今天晚上吃饭了", "it").reason());
        assertEquals("EMPTY_TRANSLATION",
                TranslationOutputSafety.assess(SOURCE, "  ", "it").reason());
    }

    @Test
    public void removesThinkingAndMarkdownFence() {
        var result = TranslationOutputSafety.assess(
                SOURCE,
                "<think>internal notes</think>\n```it\nBuonasera, hai mangiato?\n```",
                "it");

        assertTrue(result.safe());
        assertEquals("Buonasera, hai mangiato?", result.text());
    }
}

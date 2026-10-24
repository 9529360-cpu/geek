//! Frozen WhatsApp mention ranges and a pure, per-request translation envelope.
use super::{
    account::valid_id,
    error::{AppError, Result},
    translation::validate_text,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const MENTION_PREFIX: &str = "https://geek-mention.invalid/";
const RESERVED_HOST: &str = "geek-mention.invalid";
const MAX_MENTIONS: usize = 32;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SendMention {
    pub id: String,
    pub offset: u32,
    pub length: u32,
}

fn user(id: &str) -> Option<&str> {
    let (user, namespace) = id.split_once('@')?;
    (user.starts_with(|c: char| ('1'..='9').contains(&c))
        && user.len() <= 30
        && user.bytes().all(|byte| byte.is_ascii_digit())
        && matches!(namespace, "c.us" | "lid"))
    .then_some(user)
}

pub fn validate_mentions(text: &str, mentions: &[SendMention]) -> Result<()> {
    validate_text(text).map_err(|_| AppError::SendIntentInvalid)?;
    if mentions.is_empty()
        || mentions.len() > MAX_MENTIONS
        || text.to_ascii_lowercase().contains(RESERVED_HOST)
    {
        return Err(AppError::SendIntentInvalid);
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    let mut previous_end = 0;
    let mut users = HashMap::new();
    for mention in mentions {
        let name = user(&mention.id).ok_or(AppError::SendIntentInvalid)?;
        let start = mention.offset as usize;
        let end = mention
            .offset
            .checked_add(mention.length)
            .ok_or(AppError::SendIntentInvalid)? as usize;
        let canonical: Vec<u16> = format!("@{name}").encode_utf16().collect();
        if start < previous_end
            || units.get(start..end) != Some(canonical.as_slice())
            || users
                .insert(name, mention.id.as_str())
                .is_some_and(|previous| previous != mention.id)
        {
            return Err(AppError::SendIntentInvalid);
        }
        previous_end = end;
    }
    Ok(())
}

/// This value owns no cache or lifecycle. The existing SendIntent UUID is also
/// the translation billing ID, so retries reconstruct exactly the same tokens.
pub struct MentionTranslation {
    text: String,
    replacements: Vec<(String, String)>,
}

impl MentionTranslation {
    pub fn encode(id: &str, source: &str, mentions: &[SendMention]) -> Result<Self> {
        if !valid_id(id) {
            return Err(AppError::SendIntentInvalid);
        }
        validate_mentions(source, mentions)?;
        let units: Vec<u16> = source.encode_utf16().collect();
        let mut text = String::new();
        let mut replacements = Vec::with_capacity(mentions.len());
        let mut previous_end = 0;
        for (index, mention) in mentions.iter().enumerate() {
            let start = mention.offset as usize;
            let end = start + mention.length as usize;
            let before = String::from_utf16(&units[previous_end..start])
                .map_err(|_| AppError::SendIntentInvalid)?;
            text.push_str(&before);
            if text.chars().last().is_some_and(|c| !c.is_whitespace()) {
                text.push(' ');
            }
            let token = format!("{MENTION_PREFIX}{id}/{index}");
            text.push_str(&token);
            // The live translator protects a URL up to whitespace. Delimit it
            // even beside emoji, punctuation, or Chinese, rather than protecting
            // the adjacent body as part of that URL.
            let after =
                String::from_utf16(&units[end..]).map_err(|_| AppError::SendIntentInvalid)?;
            if after.chars().next().is_some_and(|c| !c.is_whitespace()) {
                text.push(' ');
            }
            let name = user(&mention.id).ok_or(AppError::SendIntentInvalid)?;
            replacements.push((token, format!("@{name}")));
            previous_end = end;
        }
        text.push_str(
            &String::from_utf16(&units[previous_end..]).map_err(|_| AppError::SendIntentInvalid)?,
        );
        // Expansion consumes the existing request budget; never truncate a body
        // or let a known over-limit request reach a paid translation call.
        validate_text(&text).map_err(|_| AppError::SendIntentInvalid)?;
        Ok(Self { text, replacements })
    }

    pub fn text(&self) -> &str {
        &self.text
    }

    pub fn decode(&self, output: &str) -> Result<String> {
        if output.len() > 128 * 1024 {
            return Err(AppError::TranslationOutputInvalid);
        }
        let mut seen = vec![false; self.replacements.len()];
        let mut decoded = String::new();
        let mut remaining = output;
        while let Some(start) = remaining.find(MENTION_PREFIX) {
            decoded.push_str(&remaining[..start]);
            let tail = &remaining[start..];
            let end = tail.find(char::is_whitespace).unwrap_or(tail.len());
            // Match the existing translation worker's terminal URL punctuation.
            let token = tail[..end].trim_end_matches([
                '.', ',', '!', '?', ';', ':', '，', '。', '！', '？', '；', '：',
            ]);
            let Some(index) = self
                .replacements
                .iter()
                .position(|(expected, _)| token == expected)
            else {
                return Err(AppError::TranslationOutputInvalid);
            };
            if std::mem::replace(&mut seen[index], true) {
                return Err(AppError::TranslationOutputInvalid);
            }
            decoded.push_str(&self.replacements[index].1);
            remaining = &tail[token.len()..];
        }
        decoded.push_str(remaining);
        if seen.iter().any(|present| !present)
            || decoded.to_ascii_lowercase().contains(RESERVED_HOST)
            || validate_text(&decoded).is_err()
        {
            return Err(AppError::TranslationOutputInvalid);
        }
        Ok(decoded)
    }
}

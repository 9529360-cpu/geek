//! The original %nc/%nr/%sa and {one|two} semantics, without JavaScript evaluation.
use super::{
    broadcast::BroadcastTarget,
    error::{AppError, Result},
};

pub fn needs_hour(message: &str) -> bool {
    message.to_ascii_lowercase().contains("%sa")
}

fn expand(message: &str, target: &BroadcastTarget, hour: u8) -> String {
    let greeting = if hour < 12 {
        "早上好"
    } else if hour < 18 {
        "下午好"
    } else {
        "晚上好"
    };
    let mut out = String::new();
    let mut offset = 0;
    while offset < message.len() {
        let tail = &message[offset..];
        let variable = tail.as_bytes().get(..3).and_then(|bytes| {
            if bytes.eq_ignore_ascii_case(b"%nc") {
                Some(target.name.as_str())
            } else if bytes.eq_ignore_ascii_case(b"%nr") {
                Some(
                    if target.real_name.trim().is_empty() || target.real_name.trim() == target.id {
                        &target.name
                    } else {
                        &target.real_name
                    },
                )
            } else if bytes.eq_ignore_ascii_case(b"%sa") {
                Some(greeting)
            } else {
                None
            }
        });
        if let Some(value) = variable {
            out.push_str(value);
            offset += 3;
        } else {
            let character = tail.chars().next().expect("non-empty remaining text");
            out.push(character);
            offset += character.len_utf8();
        }
    }
    out
}

fn variants(message: &str, mut pick: impl FnMut(&[&str]) -> usize) -> String {
    let mut out = String::new();
    let mut offset = 0;
    while offset < message.len() {
        let tail = &message[offset..];
        if let Some(body_end) = tail
            .strip_prefix('{')
            .and_then(|body| body.find('}').map(|end| end + 1))
        {
            let body = &tail[1..body_end];
            let choices: Vec<_> = body.split('|').collect();
            if choices.len() > 1
                && choices
                    .iter()
                    .all(|part| !part.is_empty() && !part.contains(['{', '}']))
            {
                let chosen = pick(&choices) % choices.len();
                out.push_str(choices[chosen].trim());
                offset += body_end + 1;
                continue;
            }
        }
        let character = tail.chars().next().expect("non-empty remaining text");
        out.push(character);
        offset += character.len_utf8();
    }
    out
}

pub fn render(
    message: &str,
    target: &BroadcastTarget,
    local_hour: u8,
    mut choice: impl FnMut(usize) -> usize,
) -> Result<String> {
    if local_hour > 23 {
        return Err(AppError::BroadcastInvalid);
    }
    let selected = variants(message, |values| choice(values.len()));
    let text = expand(&selected, target, local_hour);
    validate_text(&text)?;
    Ok(text)
}

pub fn validate_text(text: &str) -> Result<()> {
    if text.len() > 32_768
        || text.encode_utf16().count() > 10_000
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))
    {
        return Err(AppError::BroadcastInvalid);
    }
    Ok(())
}

pub fn validate_template(message: &str, target: &BroadcastTarget) -> Result<()> {
    validate_template_with_limit(message, target, 10_000)
}

pub fn validate_template_with_limit(
    message: &str,
    target: &BroadcastTarget,
    utf16_limit: usize,
) -> Result<()> {
    let lower = message.to_ascii_lowercase();
    let name = !target.name.trim().is_empty() && target.name.trim() != target.id;
    let real_name = !target.real_name.trim().is_empty() && target.real_name.trim() != target.id;
    if (lower.contains("%nc") && !name) || (lower.contains("%nr") && !real_name && !name) {
        return Err(AppError::BroadcastNameMissing);
    }
    // Choose the longest expanded branch independently for both encoding bounds.
    for utf16 in [false, true] {
        let longest = variants(message, |values| {
            values
                .iter()
                .enumerate()
                .max_by_key(|(_, value)| {
                    let expanded = expand(value.trim(), target, 0);
                    if utf16 {
                        expanded.encode_utf16().count()
                    } else {
                        expanded.len()
                    }
                })
                .map(|(index, _)| index)
                .unwrap_or(0)
        });
        let expanded = expand(&longest, target, 0);
        validate_text(&expanded)?;
        if expanded.encode_utf16().count() > utf16_limit {
            return Err(AppError::BroadcastInvalid);
        }
    }
    Ok(())
}

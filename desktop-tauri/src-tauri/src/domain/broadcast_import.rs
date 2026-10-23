//! Bounded text parsing only. Candidates acquire account authority in the catalog.
use super::{
    broadcast::MAX_TARGETS,
    error::{AppError, Result},
};
use std::collections::HashSet;

pub const MAX_IMPORT_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_PASTED_RECIPIENT_BYTES: usize = 128 * 1024;
const MAX_COLUMNS: usize = 64;

#[derive(Default)]
pub struct BroadcastImportCandidates {
    pub candidates: Vec<String>,
    pub duplicate_count: usize,
    pub invalid_count: usize,
    pub skipped_count: usize,
}

pub fn parse_broadcast_import(bytes: &[u8]) -> Result<BroadcastImportCandidates> {
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err(AppError::BroadcastImportLimit);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| AppError::BroadcastImportInvalid)?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut records = Records {
        bytes: text.as_bytes(),
        offset: 0,
        delimiter: detect_delimiter(text)?,
    };
    let first = records
        .next_nonempty()?
        .ok_or(AppError::BroadcastImportEmpty)?;
    let header = Header::read(&first)?;
    let mut result = BroadcastImportCandidates::default();
    let mut seen = HashSet::new();
    if header.is_none() {
        result.accept(&first, &Header::plain(), &mut seen)?;
    }
    let header = header.unwrap_or_else(Header::plain);
    while let Some(record) = records.next_nonempty()? {
        result.accept(&record, &header, &mut seen)?;
    }
    result.finish()
}

pub fn parse_broadcast_pasted_recipients(text: &str) -> Result<BroadcastImportCandidates> {
    if text.len() > MAX_PASTED_RECIPIENT_BYTES {
        return Err(AppError::BroadcastImportLimit);
    }
    let mut result = BroadcastImportCandidates::default();
    let mut seen = HashSet::new();
    for line in text.split(['\r', '\n']) {
        if !line.trim().is_empty() {
            result.accept_candidate(line, RecipientKind::Phone, &mut seen)?;
        }
    }
    result.finish()
}

impl BroadcastImportCandidates {
    fn finish(self) -> Result<Self> {
        if self.candidates.is_empty() {
            Err(AppError::BroadcastImportEmpty)
        } else {
            Ok(self)
        }
    }

    fn accept(
        &mut self,
        row: &[String],
        header: &Header,
        seen: &mut HashSet<String>,
    ) -> Result<()> {
        if row.len() != header.columns {
            if !header.present {
                return Err(AppError::BroadcastImportInvalid);
            }
            self.invalid_count += 1;
        } else if header
            .status
            .is_some_and(|column| row[column].trim() != "NOT_SUBMITTED")
        {
            self.skipped_count += 1;
        } else {
            self.accept_candidate(&row[header.recipient], header.kind, seen)?;
        }
        Ok(())
    }

    fn accept_candidate(
        &mut self,
        value: &str,
        kind: RecipientKind,
        seen: &mut HashSet<String>,
    ) -> Result<()> {
        if let Some(candidate) = normalize_candidate(value, kind) {
            if !seen.insert(candidate.clone()) {
                self.duplicate_count += 1;
            } else {
                if self.candidates.len() == MAX_TARGETS {
                    return Err(AppError::BroadcastImportLimit);
                }
                self.candidates.push(candidate);
            }
        } else {
            self.invalid_count += 1;
        }
        Ok(())
    }
}

struct Header {
    recipient: usize,
    kind: RecipientKind,
    status: Option<usize>,
    columns: usize,
    present: bool,
}

#[derive(Clone, Copy)]
enum RecipientKind {
    Phone,
    ChatId,
}

impl Header {
    fn plain() -> Self {
        Self {
            recipient: 0,
            kind: RecipientKind::Phone,
            status: None,
            columns: 1,
            present: false,
        }
    }

    fn read(row: &[String]) -> Result<Option<Self>> {
        let mut recipient = None;
        let mut status = None;
        for (index, cell) in row.iter().enumerate() {
            let name = cell.trim().to_ascii_lowercase();
            let kind = match name.as_str() {
                "手机号" | "手机号码" | "号码" | "电话" | "phone" | "number" | "whatsapp"
                | "mobile" => Some(RecipientKind::Phone),
                "聊天id" | "chatid" | "chat id" | "chat_id" => Some(RecipientKind::ChatId),
                _ => None,
            };
            if let Some(kind) = kind {
                if recipient.replace((index, kind)).is_some() {
                    return Err(AppError::BroadcastImportInvalid);
                }
            } else if matches!(name.as_str(), "发送状态" | "status")
                && status.replace(index).is_some()
            {
                return Err(AppError::BroadcastImportInvalid);
            }
        }
        match recipient {
            Some((recipient, kind)) => Ok(Some(Self {
                recipient,
                kind,
                status,
                columns: row.len(),
                present: true,
            })),
            None if status.is_some() || row.len() != 1 => Err(AppError::BroadcastImportInvalid),
            None => Ok(None),
        }
    }
}

fn normalize_candidate(value: &str, kind: RecipientKind) -> Option<String> {
    if value.chars().any(char::is_control) {
        return None;
    }
    let value = value.trim_matches(' ');
    if matches!(kind, RecipientKind::ChatId) {
        let (number, domain) = value.split_once('@')?;
        return (matches!(domain, "c.us" | "lid")
            && !number.is_empty()
            && number.len() <= 30
            && number.bytes().all(|c| c.is_ascii_digit()))
        .then(|| value.to_owned());
    }
    let body = value.strip_prefix('+').unwrap_or(value).trim_matches(' ');
    if !body.starts_with(|c: char| c.is_ascii_digit() || c == '(')
        || !body.ends_with(|c: char| c.is_ascii_digit() || c == ')')
    {
        return None;
    }
    let mut digits = String::new();
    let mut group_start = None;
    let mut previous = None;
    for byte in body.bytes() {
        match byte {
            b'0'..=b'9' => digits.push(char::from(byte)),
            b' ' => continue,
            b'(' if group_start.is_none() => group_start = Some(digits.len()),
            b')' if group_start.is_some_and(|start| digits.len() > start)
                && !matches!(previous, Some(b'-' | b'(')) =>
            {
                group_start = None
            }
            b'-' if !matches!(previous, None | Some(b'-' | b'(')) => {}
            _ => return None,
        }
        previous = Some(byte);
    }
    (group_start.is_none() && (6..=15).contains(&digits.len())).then_some(digits)
}

fn detect_delimiter(text: &str) -> Result<Option<u8>> {
    let mut quoted = false;
    let mut content = false;
    let mut delimiter = None;
    let mut bytes = text.bytes().peekable();
    while let Some(byte) = bytes.next() {
        if byte == b'"' {
            if quoted && bytes.peek() == Some(&b'"') {
                bytes.next();
                content = true;
                continue;
            }
            quoted = !quoted;
            continue;
        }
        if !quoted {
            if matches!(byte, b',' | b';' | b'\t') {
                if delimiter.is_some_and(|current| current != byte) {
                    return Err(AppError::BroadcastImportInvalid);
                }
                delimiter = Some(byte);
                continue;
            }
            if matches!(byte, b'\r' | b'\n') {
                if content {
                    break;
                }
                continue;
            }
        }
        content |= !byte.is_ascii_whitespace();
    }
    Ok(delimiter)
}

struct Records<'a> {
    bytes: &'a [u8],
    offset: usize,
    delimiter: Option<u8>,
}

impl Records<'_> {
    fn next_nonempty(&mut self) -> Result<Option<Vec<String>>> {
        while let Some(row) = self.next()? {
            if row.iter().any(|cell| !cell.trim().is_empty()) {
                return Ok(Some(row));
            }
        }
        Ok(None)
    }

    fn next(&mut self) -> Result<Option<Vec<String>>> {
        if self.offset == self.bytes.len() {
            return Ok(None);
        }
        let mut row = Vec::new();
        let mut field = Vec::new();
        let mut quoted = false;
        let mut closed = false;
        while self.offset < self.bytes.len() {
            let byte = self.bytes[self.offset];
            self.offset += 1;
            if quoted {
                if byte == b'"' {
                    if self.bytes.get(self.offset) == Some(&b'"') {
                        field.push(b'"');
                        self.offset += 1;
                    } else {
                        quoted = false;
                        closed = true;
                    }
                } else {
                    field.push(byte);
                }
                continue;
            }
            if matches!(byte, b'\r' | b'\n') {
                if byte == b'\r' && self.bytes.get(self.offset) == Some(&b'\n') {
                    self.offset += 1;
                }
                push_field(&mut row, field)?;
                return Ok(Some(row));
            }
            if Some(byte) == self.delimiter {
                push_field(&mut row, std::mem::take(&mut field))?;
                closed = false;
            } else if self.delimiter.is_none() && matches!(byte, b',' | b';' | b'\t') {
                return Err(AppError::BroadcastImportInvalid);
            } else if closed {
                if byte != b' ' {
                    return Err(AppError::BroadcastImportInvalid);
                }
            } else if byte == b'"' {
                if field.iter().any(|byte| *byte != b' ') {
                    return Err(AppError::BroadcastImportInvalid);
                }
                field.clear();
                quoted = true;
            } else {
                field.push(byte);
            }
        }
        if quoted {
            return Err(AppError::BroadcastImportInvalid);
        }
        push_field(&mut row, field)?;
        Ok(Some(row))
    }
}

fn push_field(row: &mut Vec<String>, bytes: Vec<u8>) -> Result<()> {
    if row.len() == MAX_COLUMNS {
        return Err(AppError::BroadcastImportInvalid);
    }
    row.push(String::from_utf8(bytes).map_err(|_| AppError::BroadcastImportInvalid)?);
    Ok(())
}

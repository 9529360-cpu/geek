//! Spreadsheet-safe cells shared by native-only CSV exports.
pub(crate) fn cell(csv: &mut String, value: &str) {
    csv.push('"');
    let visible = value.trim_start_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if visible.starts_with(['=', '+', '-', '@']) {
        csv.push('\'');
    }
    for c in value.chars() {
        match c {
            '"' => csv.push_str("\"\""),
            '\r' | '\n' => csv.push(' '),
            _ => csv.push(c),
        }
    }
    csv.push('"');
}

pub(crate) fn row<'a>(csv: &mut String, cells: impl IntoIterator<Item = &'a str>) {
    for (index, value) in cells.into_iter().enumerate() {
        if index != 0 {
            csv.push(',');
        }
        cell(csv, value);
    }
    csv.push_str("\r\n");
}

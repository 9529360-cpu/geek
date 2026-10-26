//! UTC export timestamps, independent of local UI timezone and OS date parsing.
pub(crate) fn iso_timestamp(milliseconds: u64) -> String {
    let seconds = milliseconds / 1000;
    let days = (seconds / 86_400) as i64 + 719_468;
    let era = days / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_part = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_part + 2) / 5 + 1;
    let month = month_part + if month_part < 10 { 3 } else { -9 };
    let year = year + i64::from(month <= 2);
    let clock = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        clock / 3600,
        clock / 60 % 60,
        clock % 60,
        milliseconds % 1000
    )
}

#[cfg(test)]
mod tests {
    use super::iso_timestamp;

    #[test]
    fn utc_exports_preserve_epoch_leap_days_and_milliseconds() {
        for (stamp, expected) in [
            (0, "1970-01-01T00:00:00.000Z"),
            (951_782_400_123, "2000-02-29T00:00:00.123Z"),
            (1_709_251_199_999, "2024-02-29T23:59:59.999Z"),
            (4_107_542_400_000, "2100-03-01T00:00:00.000Z"),
        ] {
            assert_eq!(iso_timestamp(stamp), expected);
        }
    }
}

use crate::domain::{
    broadcast::BroadcastIssue,
    broadcast::MAX_TARGETS,
    broadcast_import::{parse_broadcast_import, MAX_IMPORT_BYTES},
    broadcast_report::{BroadcastFailureReport, BroadcastFailureRow, BroadcastFailureStatus},
    error::AppError,
};

#[test]
fn quoted_csv_semicolon_tsv_and_plain_text_preserve_recipient_order_and_ignore_names() {
    for (separator, name) in [
        (",", "A, \"\"客户\"\"\r\n第二行"),
        (";", "A;名字"),
        ("\t", "A\t名字"),
    ] {
        let text = format!("\u{feff}姓名{separator}phone\r\n\"{name}\"{separator}\"+1 (202) 555-0101\"\r\nignored{separator}12025550102\r\n");
        let result = parse_broadcast_import(text.as_bytes()).unwrap();
        assert_eq!(result.candidates, ["12025550101", "12025550102"]);
        assert_eq!(
            (
                result.duplicate_count,
                result.invalid_count,
                result.skipped_count
            ),
            (0, 0, 0)
        );
    }
    let result = parse_broadcast_import(b"\r\n 123456 \n\"123457\"\r123458\r\n").unwrap();
    assert_eq!(result.candidates, ["123456", "123457", "123458"]);
    let result = parse_broadcast_import(b"\"\"\r\nphone,name\r\n123456,Alice\r\n").unwrap();
    assert_eq!(result.candidates, ["123456"]);
}

#[test]
fn explicit_recipient_headers_are_recognized_without_substring_or_name_guessing() {
    for header in [
        "手机号",
        "手机号码",
        "号码",
        "电话",
        "phone",
        "PHONE",
        "number",
        "whatsapp",
        "mobile",
    ] {
        let text = format!("姓名,{header},说明\nignored,12025550101,anything\n");
        assert_eq!(
            parse_broadcast_import(text.as_bytes()).unwrap().candidates,
            ["12025550101"]
        );
    }
    for header in ["聊天ID", "chatId", "chat id", "chat_id"] {
        let text = format!("姓名,{header}\nignored,12025550101@c.us\n");
        assert_eq!(
            parse_broadcast_import(text.as_bytes()).unwrap().candidates,
            ["12025550101@c.us"]
        );
    }
    for text in [
        "姓名,地址\nAlice,123456",
        "Alice,123456",
        "123456;Alice",
        "123456\n123457,Alice",
        "phone,number\n123456,123457",
        "phone,status,发送状态\n123456,NOT_SUBMITTED,NOT_SUBMITTED",
        "发送状态\nNOT_SUBMITTED",
        "homephone,name\n123456,Alice",
    ] {
        assert!(
            matches!(
                parse_broadcast_import(text.as_bytes()),
                Err(AppError::BroadcastImportInvalid)
            ),
            "{text}"
        );
    }
}

#[test]
fn normalization_rejects_garbage_and_keeps_invalid_duplicate_and_skipped_counts_separate() {
    let input = concat!(
        "phone\n+1 (202) 555-0101\n12025550101\n+1-202-555-0101\n12025550102\n",
        "tel:12025550103\n12025550104 ext 9\n+1202+5550105\n",
        "1.2025550106e10\n12345\n1234567890123456\n",
        "123456@g.us\n123456@newsletter\n123456@s.whatsapp.net\n",
        "１２３４５６\n(123456\n123456)\n12()3456\n"
    );
    let result = parse_broadcast_import(input.as_bytes()).unwrap();
    assert_eq!(result.candidates, ["12025550101", "12025550102"]);
    assert_eq!(result.duplicate_count, 2);
    assert_eq!(result.invalid_count, 13);
    assert_eq!(result.skipped_count, 0);
}

#[test]
fn reports_only_admit_explicit_not_submitted_rows_and_never_replay_uncertain_or_task_rows() {
    let text = concat!(
        "联系人,聊天ID,失败原因,发送状态\r\n",
        "first,12025550101@c.us,TARGET_CHANGED,NOT_SUBMITTED\r\n",
        "uncertain,12025550102@c.us,TIMED_OUT,UNCERTAIN\r\n",
        "task,,GUEST_CHANGED,TASK_ISSUE\r\n",
        "confirmed,12025550103@c.us,,CONFIRMED\r\n",
        "unknown,12025550104@c.us,,NEW_STATUS\r\n",
        "empty,12025550105@c.us,,\r\n",
        "duplicate,12025550101@c.us,TARGET_CHANGED,NOT_SUBMITTED\r\n",
        "invalid,garbage,TARGET_CHANGED,NOT_SUBMITTED\r\n"
    );
    let result = parse_broadcast_import(text.as_bytes()).unwrap();
    assert_eq!(result.candidates, ["12025550101@c.us"]);
    assert_eq!(
        (
            result.duplicate_count,
            result.invalid_count,
            result.skipped_count
        ),
        (1, 1, 5)
    );
}

#[test]
fn native_report_csv_round_trips_only_safe_candidates_despite_quoted_names() {
    let report = BroadcastFailureReport {
        account_id: "account".into(),
        job_id: "job".into(),
        revision: 7,
        rows: [
            (
                "=SUM(1,2)",
                "12025550101@c.us",
                BroadcastFailureStatus::NotSubmitted,
            ),
            (
                "客户, \"姓名\"",
                "12025550102@c.us",
                BroadcastFailureStatus::Uncertain,
            ),
        ]
        .into_iter()
        .map(|(name, id, status)| BroadcastFailureRow {
            name: name.into(),
            target_id: Some(id.into()),
            status,
            code: BroadcastIssue::TimedOut,
        })
        .chain(std::iter::once(BroadcastFailureRow {
            name: "任务".into(),
            target_id: None,
            status: BroadcastFailureStatus::TaskIssue,
            code: BroadcastIssue::PersistenceFailed,
        }))
        .collect(),
    };
    let result = parse_broadcast_import(report.to_csv().as_bytes()).unwrap();
    assert_eq!(result.candidates, ["12025550101@c.us"]);
    assert_eq!(result.skipped_count, 2);
    assert_eq!(result.invalid_count, 0);
}

#[test]
fn malformed_utf8_and_csv_fail_the_whole_import_without_partial_candidates() {
    assert!(matches!(
        parse_broadcast_import(&[0xff, 0xfe]),
        Err(AppError::BroadcastImportInvalid)
    ));
    for text in [
        "phone\n123456\n\"123457",
        "phone,name\n123456,\"closed\"junk",
        "phone,name\n123456,un\"quoted",
        "phone,name;status\n123456,Alice;NOT_SUBMITTED",
        "phone\n123456\n\"123457\"extra",
    ] {
        assert!(
            matches!(
                parse_broadcast_import(text.as_bytes()),
                Err(AppError::BroadcastImportInvalid)
            ),
            "{text}"
        );
    }
    let result =
        parse_broadcast_import(b"phone,name\n123456,Alice\n123457\n123458,Bob,extra\n").unwrap();
    assert_eq!(result.candidates, ["123456"]);
    assert_eq!(result.invalid_count, 2);
}

#[test]
fn empty_or_fully_rejected_inputs_have_a_distinct_empty_error() {
    for text in [
        "",
        "\u{feff}",
        " \r\n\n",
        "phone\n",
        "phone\nabc\n",
        "聊天ID,发送状态\n123456@c.us,UNCERTAIN\n",
    ] {
        assert!(
            matches!(
                parse_broadcast_import(text.as_bytes()),
                Err(AppError::BroadcastImportEmpty)
            ),
            "{text}"
        );
    }
}

#[test]
fn import_byte_limit_is_checked_before_parsing_and_accepts_the_exact_boundary() {
    let mut text = String::from("phone,name\n123456,");
    text.extend(std::iter::repeat_n('x', MAX_IMPORT_BYTES - text.len()));
    assert_eq!(
        parse_broadcast_import(text.as_bytes()).unwrap().candidates,
        ["123456"]
    );
    text.push('x');
    assert!(matches!(
        parse_broadcast_import(text.as_bytes()),
        Err(AppError::BroadcastImportLimit)
    ));
}

#[test]
fn recipient_limit_counts_unique_valid_candidates_and_never_returns_a_truncated_list() {
    let mut text = String::from("phone\n");
    for index in 0..MAX_TARGETS {
        text.push_str(&format!("1202555{index:04}\n"));
    }
    text.push_str("12025550000\n");
    let result = parse_broadcast_import(text.as_bytes()).unwrap();
    assert_eq!(result.candidates.len(), MAX_TARGETS);
    assert_eq!(result.duplicate_count, 1);
    text.push_str("12025559999\n");
    assert!(matches!(
        parse_broadcast_import(text.as_bytes()),
        Err(AppError::BroadcastImportLimit)
    ));
}

#[test]
fn explicit_contact_ids_use_current_namespace_rules_and_phone_formats_do_not_guess_countries() {
    let phones =
        parse_broadcast_import(b"phone\n000123\n+39 02-123456\n1@c.us\n100000000000001@lid\n")
            .unwrap();
    assert_eq!(phones.candidates, ["000123", "3902123456"]);
    assert_eq!(phones.invalid_count, 2);
    let text = "聊天ID\n1@c.us\n123456789012345678901234567890@lid\n1234567890123456789012345678901@lid\n+123456@c.us\n123 456@c.us\n123456@C.US\n123456@g.us\n123456\n";
    let result = parse_broadcast_import(text.as_bytes()).unwrap();
    assert_eq!(
        result.candidates,
        ["1@c.us", "123456789012345678901234567890@lid"]
    );
    assert_eq!(result.invalid_count, 6);
    assert!(matches!(
        parse_broadcast_import(b"123456@c.us\n"),
        Err(AppError::BroadcastImportEmpty)
    ));
}

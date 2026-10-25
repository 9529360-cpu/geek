use crate::domain::contact_notes::{ContactNote, ContactNotesDocument};
use crate::infrastructure::contact_notes_repository::EncryptedContactNotesRepository;

#[test]
fn encrypted_notes_roundtrip_preserves_multiline_unicode_and_account_isolation() {
    let root = tempfile::tempdir().unwrap();
    let id = "11111111-1111-4111-8111-111111111111";
    let other = "22222222-2222-4222-8222-222222222222";
    let repo = EncryptedContactNotesRepository::open(root.path(), id).unwrap();
    let mut document = ContactNotesDocument::default();
    let note = ContactNote {
        name: "客户".into(),
        notes: "第一行\nSecond line".into(),
        ..Default::default()
    };
    document
        .update("whatsapp", "customer", note.clone(), 1)
        .unwrap();
    repo.save(&document).unwrap();
    let reopened = EncryptedContactNotesRepository::open(root.path(), id).unwrap();
    assert_eq!(
        reopened.load().unwrap().profile("whatsapp", "customer"),
        Some(note)
    );
    let empty = EncryptedContactNotesRepository::open(root.path(), other).unwrap();
    assert!(empty
        .load()
        .unwrap()
        .profile("whatsapp", "customer")
        .is_none());
    document
        .update("whatsapp", "customer", ContactNote::default(), 2)
        .unwrap();
    repo.save(&document).unwrap();
    assert!(reopened
        .load()
        .unwrap()
        .profile("whatsapp", "customer")
        .is_none());
}

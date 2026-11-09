//! Issue mentions: `#123` in a description or comment, the way Redmine links
//! them. `##123` (a link with the subject) counts too; `&#123;` (an HTML
//! entity) and `abc#123` don't.

/// The issue ids mentioned in `text`, in order, without repeats.
pub fn mentioned_ids(text: &str) -> Vec<u64> {
    let bytes = text.as_bytes();
    let mut ids = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'#' {
            i += 1;
            continue;
        }
        let start = i + 1;
        let mut end = start;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        let before_ok = match i.checked_sub(1).map(|j| bytes[j]) {
            None => true,
            Some(b'#') => i < 2 || !is_word(bytes[i - 2]) && bytes[i - 2] != b'&',
            Some(c) => !is_word(c) && c != b'&',
        };
        let after_ok = end >= bytes.len() || !is_word(bytes[end]);
        if end > start
            && before_ok
            && after_ok
            && let Ok(id) = text[start..end].parse::<u64>()
            && id > 0
            && !ids.contains(&id)
        {
            ids.push(id);
        }
        i = end.max(i + 1);
    }
    ids
}

/// Whether `text` mentions issue `id`.
pub fn mentions(text: &str, id: u64) -> bool {
    mentioned_ids(text).contains(&id)
}

fn is_word(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_redmine_style_mentions() {
        assert_eq!(mentioned_ids("See #12 and (#7), also ##3."), vec![12, 7, 3]);
        assert_eq!(mentioned_ids("#12 then #12 again"), vec![12]);
        assert_eq!(mentioned_ids("Fixed in #4\nand #5"), vec![4, 5]);
    }

    #[test]
    fn ignores_what_is_not_a_mention() {
        assert!(mentioned_ids("&#123; abc#5 #12a #0 # 4 #").is_empty());
        assert!(!mentions("Seen in #123", 12));
        assert!(mentions("Seen in #12.", 12));
    }
}

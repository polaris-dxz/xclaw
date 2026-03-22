use serde::Serialize;

#[derive(Serialize)]
pub struct ReadyEvent {
    pub v: u32,
    #[serde(rename = "type")]
    pub ty: &'static str,
    pub port: u16,
}

#[derive(Serialize)]
pub struct AccessibilityPermissionEvent {
    pub v: u32,
    #[serde(rename = "type")]
    pub ty: &'static str,
    pub trusted: bool,
}

#[derive(Serialize)]
pub struct SelectionChangedEvent {
    pub v: u32,
    #[serde(rename = "type")]
    pub ty: &'static str,
    pub ts_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub has_selection: bool,
    pub confidence: &'static str,
}

impl SelectionChangedEvent {
    pub fn new(text: Option<String>, has_selection: bool, confidence: &'static str) -> Self {
        Self {
            v: 1,
            ty: "selection.changed",
            ts_ms: now_ms(),
            text,
            has_selection,
            confidence,
        }
    }
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

//! macOS Accessibility：轮询焦点元素上的 `AXSelectedText`（需「辅助功能」权限）。
use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use std::ffi::c_void;
use std::sync::mpsc::Sender;
use std::thread;
use std::time::Duration;

use crate::protocol::{AccessibilityPermissionEvent, SelectionChangedEvent};

type AXError = i32;
type AXUIElementRef = *const c_void;

const K_AX_SUCCESS: AXError = 0;

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: CFStringRef,
        value: *mut CFTypeRef,
    ) -> AXError;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFGetTypeID(cf: CFTypeRef) -> u64;
}

unsafe fn cfstring_from_cftyped_ref(val: CFTypeRef) -> Option<String> {
    if val.is_null() {
        return None;
    }
    let tid = CFGetTypeID(val);
    if tid as usize != CFString::type_id() {
        return None;
    }
    let cf = CFString::wrap_under_create_rule(val as CFStringRef);
    Some(cf.to_string())
}

unsafe fn copy_focused_element(system_wide: AXUIElementRef) -> Option<AXUIElementRef> {
    let key = CFString::new("AXFocusedUIElement");
    let mut focused: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(
        system_wide,
        key.as_concrete_TypeRef(),
        &mut focused,
    );
    if err != K_AX_SUCCESS || focused.is_null() {
        if !focused.is_null() {
            CFRelease(focused);
        }
        return None;
    }
    Some(focused as AXUIElementRef)
}

unsafe fn copy_selected_text(element: AXUIElementRef) -> Option<String> {
    let key = CFString::new("AXSelectedText");
    let mut text_val: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut text_val);
    if err != K_AX_SUCCESS || text_val.is_null() {
        if !text_val.is_null() {
            CFRelease(text_val);
        }
        return None;
    }
    let s = cfstring_from_cftyped_ref(text_val);
    CFRelease(text_val);
    s
}

pub fn run_monitor(tx: Sender<String>, mock: bool) {
    if mock {
        super::mock_loop::run(tx);
        return;
    }

    let mut warned_untrusted = false;
    let mut last_fingerprint: Option<String> = None;

    loop {
        if !unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) } {
            if !warned_untrusted {
                warned_untrusted = true;
                let ev = AccessibilityPermissionEvent {
                    v: 1,
                    ty: "accessibility.permission",
                    trusted: false,
                };
                let _ = tx.send(serde_json::to_string(&ev).unwrap());
            }
            thread::sleep(Duration::from_millis(800));
            continue;
        }

        let (has_sel, text_opt, confidence) = unsafe { poll_ax_selection() };

        let fp = match &text_opt {
            Some(t) => format!("1:{t}"),
            None if !has_sel => "0:".to_string(),
            None => "1:".to_string(),
        };
        if last_fingerprint.as_ref() == Some(&fp) {
            thread::sleep(Duration::from_millis(200));
            continue;
        }
        last_fingerprint = Some(fp);

        let ev = SelectionChangedEvent::new(text_opt, has_sel, confidence);
        if tx.send(serde_json::to_string(&ev).unwrap()).is_err() {
            break;
        }

        thread::sleep(Duration::from_millis(200));
    }
}

/// 返回 (has_selection, text, confidence)
unsafe fn poll_ax_selection() -> (bool, Option<String>, &'static str) {
    let system_wide = AXUIElementCreateSystemWide();
    if system_wide.is_null() {
        return (false, None, "low");
    }

    let focused = match copy_focused_element(system_wide) {
        Some(f) => f,
        None => {
            CFRelease(system_wide as CFTypeRef);
            return (false, None, "medium");
        }
    };

    let text = copy_selected_text(focused);
    CFRelease(focused as CFTypeRef);
    CFRelease(system_wide as CFTypeRef);

    match text {
        Some(t) if !t.is_empty() => (true, Some(t), "high"),
        Some(_) => (false, None, "medium"),
        None => (false, None, "medium"),
    }
}

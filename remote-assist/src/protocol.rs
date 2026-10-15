//! Optional per-user protocol registration. Only native button clicks call these.
//! No startup entry/service or credentials are written. Manual pairing remains primary.
use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr::{null, null_mut}};
use url::Url;
type Key = *mut c_void;
#[link(name = "advapi32")]
extern "system" {
    fn RegCreateKeyExW(key: Key, path: *const u16, reserved: u32, class: *mut u16, options: u32, access: u32, security: *const c_void, result: *mut Key, disposition: *mut u32) -> i32;
    fn RegSetValueExW(key: Key, name: *const u16, reserved: u32, kind: u32, data: *const u8, bytes: u32) -> i32;
    fn RegCloseKey(key: Key) -> i32;
    fn RegDeleteTreeW(key: Key, path: *const u16) -> i32;
}
const ROOT: &str = "Software\\Classes\\snapkey-remote-assist";
fn hkcu() -> Key { 0x80000001u32 as i32 as isize as Key }
fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }
fn set(path: &str, name: Option<&str>, value: &str) -> Result<(), &'static str> {
    let path = wide(path); let name = name.map(wide); let value = wide(value); let mut key = null_mut();
    if unsafe { RegCreateKeyExW(hkcu(), path.as_ptr(), 0, null_mut(), 0, 2, null(), &mut key, null_mut()) } != 0 { return Err("Cannot create protocol key"); }
    let status = unsafe { RegSetValueExW(key, name.as_ref().map_or(null(), |n| n.as_ptr()), 0, 1, value.as_ptr().cast(), (value.len()*2) as u32) };
    unsafe { RegCloseKey(key); }
    if status != 0 { return Err("Cannot write protocol key"); }
    Ok(())
}
pub fn register() -> Result<(), Box<dyn std::error::Error>> {
    let exe = std::env::current_exe()?;
    // Paths on Windows cannot contain quotation marks. Encode the exact absolute path.
    let command: Vec<u16> = ['"' as u16].into_iter().chain(exe.as_os_str().encode_wide()).chain("\" \"%1\"".encode_utf16()).collect();
    let command = String::from_utf16(&command)?;
    set(ROOT, None, "URL:SnapKey Remote Assist")?;
    set(ROOT, Some("URL Protocol"), "")?;
    set(&format!("{}\\shell\\open\\command", ROOT), None, &command)?;
    Ok(())
}
pub fn unregister() -> Result<(), &'static str> {
    let path = wide(ROOT);
    let status = unsafe { RegDeleteTreeW(hkcu(), path.as_ptr()) };
    if status == 0 || status == 2 { Ok(()) } else { Err("Cannot remove protocol key") }
}
pub fn pairing_from_argument(argument: &str) -> Option<String> {
    let launch = Url::parse(argument).ok()?;
    if launch.scheme() != "snapkey-remote-assist" || launch.host_str() != Some("pair") || !launch.username().is_empty() || launch.password().is_some() || launch.port().is_some() || launch.fragment().is_some() || !matches!(launch.path(), "" | "/") { return None; }
    let values: Vec<_> = launch.query_pairs().collect();
    if values.len() != 2 { return None; }
    let origin = values.iter().find(|(k,_)| k == "origin")?.1.as_ref();
    let ticket = values.iter().find(|(k,_)| k == "ticket")?.1.as_ref();
    if ticket.len() < 32 || ticket.len() > 128 || !ticket.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') { return None; }
    let mut url = Url::parse(origin).ok()?;
    let trusted = Url::parse(option_env!("SNAPKEY_REMOTE_ASSIST_ORIGIN").unwrap_or("https://connect.snapkeystudio.com")).ok()?;
    if url.scheme() != "https" || url.origin() != trusted.origin() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path() != "/" { return None; }
    url.set_fragment(Some(ticket));
    Some(url.to_string())
}
pub fn launch_pairing() -> Option<String> { pairing_from_argument(&std::env::args().nth(1)?) }
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn launch_only_prefills_trusted_pairing() {
        let origin = option_env!("SNAPKEY_REMOTE_ASSIST_ORIGIN").unwrap_or("https://connect.snapkeystudio.com");
        let mut url = Url::parse("snapkey-remote-assist://pair").unwrap();
        url.query_pairs_mut().append_pair("origin", origin).append_pair("ticket", &"a".repeat(43));
        assert!(pairing_from_argument(url.as_str()).unwrap().contains('#'));
    }
    #[test] fn untrusted_or_malformed_launch_is_rejected() {
        assert!(pairing_from_argument("https://evil.example/").is_none());
        assert!(pairing_from_argument("snapkey-remote-assist://pair?origin=https%3A%2F%2Fevil.example&ticket=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").is_none());
        assert!(pairing_from_argument("snapkey-remote-assist://pair?origin=https%3A%2F%2Fconnect.snapkeystudio.com&ticket=short").is_none());
    }
}
